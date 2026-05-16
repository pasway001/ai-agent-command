import { z } from "zod";
import {
  startRun,
  finishRun,
  failRun,
  recordAutoEvaluation,
  enqueueApproval,
  upsertProduct,
  getActivePrompt,
  getAttachedSkills,
  composeSystemPrompt,
} from "../agent-sdk";
import { runStructured } from "../llm";
import { getRecentDisagreements } from "../db/queries";

export const AGENT_ID = "scout.scoring";

/**
 * Aggregated signals about a candidate product, normally produced by the
 * upstream scout.* agents (keepa_monitor, sellersprite_research, perplexity_jp_market).
 * For now we accept them directly so we can drive scoring without those agents
 * running for real.
 */
export const CandidateSignalsSchema = z.object({
  asin: z.string().optional(),
  jan: z.string().optional(),
  title: z.string(),
  category: z.string().optional(),
  keepa: z
    .object({
      bsr: z.number().optional(),
      priceJpy: z.number().optional(),
      stockEstimate: z.number().optional(),
      reviewCount: z.number().optional(),
    })
    .optional(),
  sellersprite: z
    .object({
      monthlySalesJpy: z.number().optional(),
      competitorCount: z.number().optional(),
      avgRating: z.number().optional(),
    })
    .optional(),
  perplexity: z
    .object({
      domesticDemandTrend: z.enum(["rising", "flat", "declining"]).optional(),
      regulatoryRisk: z.enum(["low", "medium", "high"]).optional(),
      summary: z.string().optional(),
    })
    .optional(),
});
export type CandidateSignals = z.infer<typeof CandidateSignalsSchema>;

const ScoringOutputSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: z.enum(["approve", "reject", "escalate"]),
  rationale: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  suggestedPriority: z.number().int().min(0).max(10),
});
export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;

/**
 * Deterministic mock scoring used while no real LLM key is wired up.
 * Computes a 0..1 score from a few weighted heuristics and returns a verdict.
 * This is only good enough to drive the UI end-to-end; once we plug in an LLM
 * the same return shape is used.
 */
function mockScore(signals: CandidateSignals): ScoringOutput {
  const pros: string[] = [];
  const cons: string[] = [];
  let score = 0.4; // baseline

  const bsr = signals.keepa?.bsr;
  if (bsr !== undefined) {
    if (bsr <= 5000) {
      score += 0.18;
      pros.push(`BSR ${bsr.toLocaleString()} は上位水準`);
    } else if (bsr <= 30000) {
      score += 0.08;
      pros.push(`BSR ${bsr.toLocaleString()} は中位水準`);
    } else if (bsr > 100000) {
      score -= 0.1;
      cons.push(`BSR ${bsr.toLocaleString()} は下位で需要が薄い`);
    }
  }

  const monthly = signals.sellersprite?.monthlySalesJpy;
  if (monthly !== undefined) {
    if (monthly >= 2_000_000) {
      score += 0.18;
      pros.push(`月商推定 ¥${monthly.toLocaleString()} で十分な市場規模`);
    } else if (monthly >= 500_000) {
      score += 0.08;
      pros.push(`月商推定 ¥${monthly.toLocaleString()} で参入余地あり`);
    } else {
      score -= 0.05;
      cons.push(`月商推定 ¥${monthly.toLocaleString()} は小さめ`);
    }
  }

  const competitors = signals.sellersprite?.competitorCount;
  if (competitors !== undefined) {
    if (competitors <= 5) {
      score += 0.1;
      pros.push(`競合 ${competitors} 社で空きあり`);
    } else if (competitors >= 20) {
      score -= 0.1;
      cons.push(`競合 ${competitors} 社で過密`);
    }
  }

  const trend = signals.perplexity?.domesticDemandTrend;
  if (trend === "rising") {
    score += 0.1;
    pros.push("国内需要は上昇トレンド");
  } else if (trend === "declining") {
    score -= 0.1;
    cons.push("国内需要は減少トレンド");
  }

  const risk = signals.perplexity?.regulatoryRisk;
  if (risk === "high") {
    score -= 0.2;
    cons.push("規制リスクが高い（薬機法/景表法など要確認）");
  } else if (risk === "medium") {
    score -= 0.05;
    cons.push("規制リスクは中程度");
  } else if (risk === "low") {
    pros.push("規制リスクは低い");
  }

  score = Math.max(0, Math.min(1, score));

  let verdict: ScoringOutput["verdict"];
  let suggestedPriority: number;
  if (score >= 0.7) {
    verdict = "approve";
    suggestedPriority = 5;
  } else if (score >= 0.5) {
    verdict = "escalate";
    suggestedPriority = 2;
  } else {
    verdict = "reject";
    suggestedPriority = 0;
  }

  const rationale =
    `総合スコア ${(score * 100).toFixed(0)}/100。` +
    (pros.length ? ` 強み: ${pros.join("、")}。` : "") +
    (cons.length ? ` 懸念: ${cons.join("、")}。` : "");

  return {
    score: Number(score.toFixed(3)),
    verdict,
    rationale,
    pros,
    cons,
    suggestedPriority,
  };
}

export const DEFAULT_SYSTEM_PROMPT = `You are an Amazon JP product scout scoring assistant.
Given aggregated market signals about one candidate product, produce a JSON object with:
- score (0..1): overall attractiveness
- verdict: "approve" | "reject" | "escalate"
- rationale (Japanese)
- pros (array of short Japanese strings)
- cons (array of short Japanese strings)
- suggestedPriority (0..10): how urgently the human reviewer should look at it.
Be concise. Reject items with high regulatory risk unless strong upside.`;

type FewShot = {
  productTitle: string | null;
  autoVerdict: string;
  humanVerdict: string;
  humanNote: string | null;
};

function userPromptFromSignals(
  s: CandidateSignals,
  fewShots: FewShot[]
): string {
  const lines: string[] = [];

  if (fewShots.length > 0) {
    lines.push(
      "## Past disagreements (the auto judgement was overridden by a human reviewer)"
    );
    lines.push(
      "Use these as calibration. Do NOT repeat the same kind of mistake."
    );
    fewShots.forEach((f, i) => {
      lines.push(
        `${i + 1}. "${f.productTitle ?? "(no title)"}" — auto said ${f.autoVerdict}, human said ${f.humanVerdict}.` +
          (f.humanNote ? ` Reviewer note: ${f.humanNote}` : "")
      );
    });
    lines.push("");
    lines.push("## Now evaluate this candidate");
  }

  lines.push(`Title: ${s.title}`);
  if (s.category) lines.push(`Category: ${s.category}`);
  if (s.keepa) lines.push(`Keepa: ${JSON.stringify(s.keepa)}`);
  if (s.sellersprite) lines.push(`SellerSprite: ${JSON.stringify(s.sellersprite)}`);
  if (s.perplexity) lines.push(`Perplexity: ${JSON.stringify(s.perplexity)}`);

  return lines.join("\n");
}

export type ScoreCandidateResult = {
  productId: string;
  runId: string;
  output: ScoringOutput;
  enqueuedApprovalId: string | null;
};

/** Re-score an existing product by reading signals from products.metadata. */
export async function scoreExistingProduct(productId: string) {
  const { db } = await import("../db");
  const { products: productsTable } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  if (!row) throw new Error(`product ${productId} not found`);
  const meta = (row.metadata ?? {}) as {
    signals?: Partial<CandidateSignals>;
    category?: string;
  };
  const signals: CandidateSignals = {
    asin: row.asin ?? undefined,
    jan: row.jan ?? undefined,
    title: row.title,
    category: meta.category,
    keepa: meta.signals?.keepa,
    sellersprite: meta.signals?.sellersprite,
    perplexity: meta.signals?.perplexity,
  };
  return scoreCandidate(signals);
}

/**
 * Run scout.scoring against a single candidate end-to-end:
 *   upsertProduct → startRun → LLM (or mock) → recordAutoEvaluation → finishRun
 *   → enqueueApproval (when verdict != reject)
 */
export async function scoreCandidate(
  rawSignals: CandidateSignals
): Promise<ScoreCandidateResult> {
  const signals = CandidateSignalsSchema.parse(rawSignals);

  const product = await upsertProduct({
    title: signals.title,
    asin: signals.asin,
    jan: signals.jan,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: { signals },
  });

  const [activePrompt, attachedSkills] = await Promise.all([
    getActivePrompt(AGENT_ID),
    getAttachedSkills(AGENT_ID),
  ]);
  const basePrompt = activePrompt?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = composeSystemPrompt(basePrompt, attachedSkills);

  const disagreementRows = await getRecentDisagreements(AGENT_ID, 5);
  const fewShots: FewShot[] = disagreementRows.map((d) => ({
    productTitle: d.product_title,
    autoVerdict: d.auto_verdict,
    humanVerdict: d.human_verdict,
    humanNote: d.human_note,
  }));

  const run = await startRun({
    agentId: AGENT_ID,
    productId: product.id,
    promptId: activePrompt?.id ?? null,
    inputPayload: {
      signals,
      promptVersion: activePrompt?.version ?? null,
      fewShots,
      skillSlugs: attachedSkills.map((s) => s.slug),
      composedSystemPrompt: systemPrompt,
    },
  });

  try {
    const { data, usage, provider, model } = await runStructured({
      system: systemPrompt,
      user: userPromptFromSignals(signals, fewShots),
      schema: ScoringOutputSchema,
      mock: () => mockScore(signals),
    });

    await recordAutoEvaluation({
      runId: run.id,
      productId: product.id,
      verdict: data.verdict,
      score: data.score,
      reasoning: data.rationale,
      evidence: { pros: data.pros, cons: data.cons, provider, model },
    });

    await finishRun({
      runId: run.id,
      agentId: AGENT_ID,
      outputPayload: { ...data, provider, model },
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
    });

    let enqueuedApprovalId: string | null = null;
    if (data.verdict !== "reject") {
      const item = await enqueueApproval({
        runId: run.id,
        productId: product.id,
        priority: data.suggestedPriority,
        requiredRole: "reviewer",
      });
      enqueuedApprovalId = item.id;
    }

    return {
      productId: product.id,
      runId: run.id,
      output: data,
      enqueuedApprovalId,
    };
  } catch (err) {
    await failRun({
      runId: run.id,
      agentId: AGENT_ID,
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}
