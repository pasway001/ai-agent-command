import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  startRun,
  finishRun,
  failRun,
  recordAutoEvaluation,
  enqueueApproval,
  findOrCreateProduct,
  mergeProductMetadata,
  getActivePrompt,
  getAttachedSkills,
  composeSystemPrompt,
} from "../agent-sdk";
import { SONNET_MODEL, runStructured } from "../llm";
import { getRecentDisagreements } from "../db/queries";
import { approvalQueue } from "../db/schema";
import {
  PRODUCT_TYPES,
  classifyProductText,
} from "./product-classification";
import { modelForProvider, resolveScoutClaudeProvider } from "./provider";

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
  productType: z.enum(PRODUCT_TYPES).optional(),
  physicalProductLikely: z.boolean().optional(),
  exclusionReason: z.string().optional(),
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
      /** Evidence URLs from Perplexity research — cited in scoring evidence. */
      evidence: z
        .array(
          z.object({
            claim: z.string(),
            sourceUrl: z.string().url(),
            snippet: z.string().max(300),
          })
        )
        .optional(),
    })
    .optional(),
  overseas: z
    .object({
      source: z.string().optional(),
      url: z.string().url().optional(),
      country: z.string().optional(),
      currency: z.string().optional(),
      pledgedAmount: z.number().optional(),
      backers: z.number().optional(),
      priceJpy: z.number().optional(),
      description: z.string().optional(),
      publishedAt: z.string().optional(),
    })
    .optional(),
  japan: z
    .object({
      notYetInJapan: z.boolean().optional(),
      similarProductCount: z.number().optional(),
      domesticExamples: z.array(z.string()).optional(),
      searchSummary: z.string().optional(),
      /** 0..1, derived from Japan reference sources (CF platforms + product media). */
      japanValidationLevel: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /**
   * Cross-source merge metadata (Phase B): when minimal-scout merges candidates
   * that appear in multiple primary sources, it stores the source names here.
   */
  mentionSources: z.array(z.string()).optional(),
  /** Auto-computed: min(mentionSources.length / 3, 1). Hint to the LLM. */
  crossSourceScore: z.number().min(0).max(1).optional(),
});
export type CandidateSignals = z.infer<typeof CandidateSignalsSchema>;

/**
 * Phase B: 9-axis scoring schema.
 *
 * Each axis is independently scored 0..1 with a short Japanese rationale.
 * The LLM is required to return an evidence array citing source URLs;
 * if validation fails we fall back to a reject verdict via parseScoringOutput.
 *
 * Backward compat: `score` is preserved as an alias of `totalScore` and the
 * legacy verdict/rationale/pros/cons/suggestedPriority fields are unchanged.
 */
const AxisScoreSchema = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string(),
});

const AxisScoresSchema = z.object({
  overseasTraction: AxisScoreSchema,
  crossSourceMentions: AxisScoreSchema,
  japanValidationLevel: AxisScoreSchema,
  domesticTrend: AxisScoreSchema,
  regulatoryRisk: AxisScoreSchema,
  competitionDensity: AxisScoreSchema,
  priceFit: AxisScoreSchema,
  physicalLikely: AxisScoreSchema,
  novelty: AxisScoreSchema,
});

const EvidenceItemSchema = z.object({
  claim: z.string(),
  sourceUrl: z.string().url(),
  snippet: z.string().min(10),
});

/**
 * Public schema accepted by the LLM. We accept either the new `totalScore`
 * or the legacy `score`, and accept legacy outputs with no axisScores/evidence
 * (mock path). The wrapper `parseScoringOutput` normalizes everything to the
 * full Phase-B shape so downstream code can assume both forms.
 */
const ScoringOutputSchema = z
  .object({
    totalScore: z.number().min(0).max(1).optional(),
    score: z.number().min(0).max(1).optional(),
    axisScores: AxisScoresSchema.optional(),
    evidence: z.array(EvidenceItemSchema).optional(),
    verdict: z.enum(["approve", "reject", "escalate"]),
    rationale: z.string(),
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    suggestedPriority: z.number().min(0).max(10),
  })
  .refine((v) => v.totalScore !== undefined || v.score !== undefined, {
    message: "Either totalScore or score is required",
  });

export type AxisScore = z.infer<typeof AxisScoreSchema>;
export type AxisScores = z.infer<typeof AxisScoresSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export type ScoringOutput = {
  /** Canonical 0..1 score (alias: totalScore). */
  score: number;
  totalScore: number;
  axisScores: AxisScores | null;
  evidence: EvidenceItem[];
  verdict: "approve" | "reject" | "escalate";
  rationale: string;
  pros: string[];
  cons: string[];
  suggestedPriority: number;
};

function emptyAxisScores(): AxisScores {
  const zero: AxisScore = { score: 0, rationale: "" };
  return {
    overseasTraction: zero,
    crossSourceMentions: zero,
    japanValidationLevel: zero,
    domesticTrend: zero,
    regulatoryRisk: zero,
    competitionDensity: zero,
    priceFit: zero,
    physicalLikely: zero,
    novelty: zero,
  };
}

/**
 * Normalize raw LLM output (which may use the new or legacy shape) into a
 * uniform Phase-B ScoringOutput. If parsing fails outright we synthesize a
 * reject verdict so the pipeline never crashes on malformed JSON.
 */
export function parseScoringOutput(raw: unknown): ScoringOutput {
  const parsed = ScoringOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      score: 0,
      totalScore: 0,
      axisScores: emptyAxisScores(),
      evidence: [],
      verdict: "reject",
      rationale: `evidence missing or output invalid (${parsed.error.message.slice(0, 200)})`,
      pros: [],
      cons: ["LLM出力が想定スキーマに合致しませんでした"],
      suggestedPriority: 0,
    };
  }
  const v = parsed.data;
  const total = v.totalScore ?? v.score ?? 0;
  return {
    score: total,
    totalScore: total,
    axisScores: v.axisScores ?? null,
    evidence: v.evidence ?? [],
    verdict: v.verdict,
    rationale: v.rationale,
    pros: v.pros ?? [],
    cons: v.cons ?? [],
    suggestedPriority: Math.round(v.suggestedPriority),
  };
}

function classifySignals(signals: CandidateSignals) {
  return classifyProductText({
    title: signals.title,
    category: signals.category,
    description: signals.overseas?.description,
    source: signals.overseas?.source,
    summary: signals.perplexity?.summary,
    declaredProductType: signals.productType,
    declaredPhysicalProductLikely: signals.physicalProductLikely,
  });
}

function normalizeSignals(signals: CandidateSignals): CandidateSignals {
  const classification = classifySignals(signals);
  return {
    ...signals,
    productType: classification.productType,
    physicalProductLikely: classification.physicalProductLikely,
    exclusionReason: classification.exclusionReason,
  };
}

function nonPhysicalRejection(signals: CandidateSignals): ScoringOutput | null {
  if (
    signals.productType === "physical" &&
    signals.physicalProductLikely === true
  ) {
    return null;
  }

  const reason =
    signals.exclusionReason ??
    "物理的に製造・発送できる商品か判断できないため対象外";
  const subject =
    signals.productType === "unknown"
      ? "物理商品か判断不能"
      : "無形商材";

  const axes = emptyAxisScores();
  axes.physicalLikely = { score: 0, rationale: reason };

  return {
    score: 0,
    totalScore: 0,
    axisScores: axes,
    evidence: [],
    verdict: "reject",
    rationale: `${reason}。${subject}のため対象外。Amazon JPやクラウドファンディングで販売できる物理商品ではありません。`,
    pros: [],
    cons: [reason],
    suggestedPriority: 0,
  };
}

/**
 * Deterministic mock scoring used while no real LLM key is wired up.
 * Computes a 0..1 score from a few weighted heuristics and returns a verdict.
 * This is only good enough to drive the UI end-to-end; once we plug in an LLM
 * the same return shape is used.
 */
function mockScore(signals: CandidateSignals): ScoringOutput {
  const forcedRejection = nonPhysicalRejection(signals);
  if (forcedRejection) return forcedRejection;

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

  const backers = signals.overseas?.backers;
  if (backers !== undefined) {
    if (backers >= 1000) {
      score += 0.12;
      pros.push(`海外で ${backers.toLocaleString()} 人規模の反応`);
    } else if (backers >= 250) {
      score += 0.06;
      pros.push(`海外で初期需要あり（${backers.toLocaleString()}人）`);
    }
  }

  const pledged = signals.overseas?.pledgedAmount;
  if (pledged !== undefined) {
    if (pledged >= 100_000) {
      score += 0.1;
      pros.push("海外クラファン/紹介元で強い支援額シグナル");
    } else if (pledged < 10_000) {
      score -= 0.04;
      cons.push("海外支援額シグナルはまだ弱い");
    }
  }

  const notYetInJapan = signals.japan?.notYetInJapan;
  const similarCount = signals.japan?.similarProductCount;
  if (notYetInJapan === true || similarCount === 0) {
    score += 0.12;
    pros.push("日本で未展開または類似が少ない");
  } else if (similarCount !== undefined && similarCount >= 5) {
    score -= 0.08;
    cons.push(`国内類似が ${similarCount} 件あり差別化が必要`);
  }

  const priceJpy = signals.overseas?.priceJpy ?? signals.keepa?.priceJpy;
  if (priceJpy !== undefined) {
    if (priceJpy >= 8_000 && priceJpy <= 30_000) {
      score += 0.06;
      pros.push("越境CFで扱いやすい価格帯");
    } else if (priceJpy < 2_000) {
      score -= 0.04;
      cons.push("単価が低く広告費を吸収しにくい");
    }
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

  // Build a synthetic 9-axis breakdown for the mock so downstream UI has data.
  const axes = emptyAxisScores();
  const overseasAxis =
    (signals.overseas?.backers ?? 0) >= 1000 ||
    (signals.overseas?.pledgedAmount ?? 0) >= 100_000
      ? 0.9
      : (signals.overseas?.backers ?? 0) >= 250
        ? 0.5
        : 0.2;
  axes.overseasTraction = { score: overseasAxis, rationale: "海外シグナル(モック)" };
  axes.crossSourceMentions = {
    score: signals.crossSourceScore ?? 0.3,
    rationale: "クロスソース言及(モック)",
  };
  axes.japanValidationLevel = {
    score:
      signals.japan?.japanValidationLevel ??
      (signals.japan?.notYetInJapan === false &&
      (signals.japan?.similarProductCount ?? 0) > 0
        ? 0.7
        : 0.3),
    rationale: "日本クラファン参照(モック)",
  };
  axes.domesticTrend = {
    score: trend === "rising" ? 0.8 : trend === "declining" ? 0.2 : 0.5,
    rationale: `国内需要(${trend ?? "不明"})`,
  };
  axes.regulatoryRisk = {
    score: risk === "low" ? 0.9 : risk === "medium" ? 0.5 : risk === "high" ? 0.1 : 0.6,
    rationale: `規制リスク(${risk ?? "不明"})`,
  };
  axes.competitionDensity = {
    score:
      competitors === undefined
        ? 0.5
        : competitors <= 5
          ? 0.9
          : competitors >= 20
            ? 0.2
            : 0.5,
    rationale: `競合密度(${competitors ?? "不明"})`,
  };
  axes.priceFit = {
    score:
      priceJpy === undefined
        ? 0.5
        : priceJpy >= 8000 && priceJpy <= 30000
          ? 0.9
          : priceJpy < 2000
            ? 0.2
            : 0.5,
    rationale: `価格帯(${priceJpy ?? "不明"})`,
  };
  axes.physicalLikely = {
    score: signals.physicalProductLikely ? 1 : 0,
    rationale: signals.physicalProductLikely
      ? "物理商品と判定"
      : "物理商品ではない可能性",
  };
  axes.novelty = { score: 0.5, rationale: "モックでは判定不能" };

  return {
    score: Number(score.toFixed(3)),
    totalScore: Number(score.toFixed(3)),
    axisScores: axes,
    evidence: [
      // mock evidence: provide the overseas URL if available so downstream UI
      // doesn't break on empty arrays.
      ...(signals.overseas?.url
        ? [
            {
              claim: "海外ソースに該当エントリあり",
              sourceUrl: signals.overseas.url,
              snippet: (signals.overseas.description ?? signals.title).slice(
                0,
                200
              ),
            },
          ]
        : []),
    ],
    verdict,
    rationale,
    pros,
    cons,
    suggestedPriority,
  };
}

const PHYSICAL_PRODUCT_POLICY_PROMPT = `Non-negotiable product scope:
- Only evaluate tangible products that can be manufactured, stocked, shipped, and sold as physical goods on Amazon JP or a crowdfunding/pre-order platform.
- Reject SaaS, apps, software, AI tools, platforms, APIs, browser extensions, newsletters, courses, communities, templates, consulting/services, and any other intangible offering even if traction looks strong.
- If it is unclear whether the candidate is a shippable physical product, reject it. In the Japanese rationale, explicitly leave the reason, e.g. "無形商材のため対象外" or "物理商品か判断できないため対象外".`;

export const DEFAULT_SYSTEM_PROMPT = `You are an Amazon JP and crowdfunding physical product scout. Your job is to score ONE candidate across 9 axes and return strictly valid JSON.

${PHYSICAL_PRODUCT_POLICY_PROMPT}

## 9-axis scoring rubric (each axis: score 0..1 + short Japanese rationale)
1. overseasTraction — Overseas market response.
   0.0-0.2: <100 backers / <$10k pledged / Reddit score <50.
   0.4-0.6: 250-1k backers OR $10k-$100k pledged OR Reddit score 50-500.
   0.8-1.0: 10k+ backers OR $100k+ pledged OR Reddit score >1000 OR Show HN >300pt.
2. crossSourceMentions — Mentioned across multiple sources we monitor.
   1 source → 0.2, 2 → 0.5, 3+ → 0.8-1.0. Use the "Cross-source signal" hint provided.
3. japanValidationLevel — Similar product or demand signal from Japan reference sources.
   Sources include Makuake, CAMPFIRE, GREEN FUNDING when available, plus Japanese product media such as GetNavi, Gizmodo Japan, ROOMIE, Lifehacker Japan, and 家電 Watch.
   No match → 0.3 (neutral, not negative).
   Loose match → 0.6 (validated demand).
   Strong match → 0.8-1.0 (proven JP demand, opportunity to enter).
4. domesticTrend — Japan demand trend (rising / flat / declining).
5. regulatoryRisk — 1.0 = no risk, 0.0 = blocked by 薬機法 / 景表法 / PSE / 電波法 / 食品衛生法 etc.
6. competitionDensity — 1.0 = open white space, 0.0 = saturated commodity.
7. priceFit — Crowdfunding sweet spot ¥8,000-¥30,000 → 0.9. <¥2,000 or >¥80,000 → 0.2.
8. physicalLikely — Confidence this is a shippable physical good (must be 1.0 to approve).
9. novelty — Unique mechanism / design / use case vs. existing JP retail.

## Hard rules
- Output MUST validate against the JSON schema below. No prose outside JSON. No markdown fences.
- You are given pre-fetched market research in the "Perplexity research" section (competitor prices, CF history, regulatory flags, demand trend). Use those facts and their source URLs to populate the evidence array. Do NOT invent URLs or claim facts not present in the provided research.
- evidence array must contain at least 1 item. If the provided research has no citable URLs, use the overseas product URL from "Overseas signal" as the single evidence item.
- If the provided research data is missing or empty for a dimension, score that axis conservatively (0.5) and note "研究データなし" in the rationale. Do NOT reject solely because research is absent.
- totalScore = weighted average across the 9 axes. Bias slightly toward overseasTraction × crossSourceMentions × physicalLikely (these are the 3 must-haves for approval).
- verdict mapping: totalScore >= 0.7 → approve; 0.5-0.7 → escalate; <0.5 → reject. Override to reject if physicalLikely < 0.5 or regulatoryRisk < 0.2.
- All rationale text must be Japanese, terse, and reference the evidence.

## Required JSON shape
{
  "totalScore": number,
  "axisScores": {
    "overseasTraction": { "score": number, "rationale": "..." },
    "crossSourceMentions": { "score": number, "rationale": "..." },
    "japanValidationLevel": { "score": number, "rationale": "..." },
    "domesticTrend": { "score": number, "rationale": "..." },
    "regulatoryRisk": { "score": number, "rationale": "..." },
    "competitionDensity": { "score": number, "rationale": "..." },
    "priceFit": { "score": number, "rationale": "..." },
    "physicalLikely": { "score": number, "rationale": "..." },
    "novelty": { "score": number, "rationale": "..." }
  },
  "evidence": [{ "claim": "...", "sourceUrl": "https://...", "snippet": "..." }],
  "verdict": "approve" | "reject" | "escalate",
  "rationale": "...",
  "pros": ["..."],
  "cons": ["..."],
  "suggestedPriority": 0..10
}

## Japan Market Scoring Refinements

### 1. Japan Gift Culture (ギフト需要)
Japanese CF supporters frequently back products both for personal use and as gifts.
Products that are clearly giftable (elegant packaging, broad appeal, seasonal relevance, price ¥3,000-¥15,000) should receive a bonus of +0.05 to +0.10 on the priceFit and novelty axes.
Signals of gift suitability: mentioned in gift guides, aesthetically distinctive packaging, unisex appeal, or categories such as stationery, kitchen gadgets, wellness, beauty tools, and travel accessories.

### 2. Makuake Success Pattern
Products with the following attributes historically perform well on Makuake and should score higher on japanValidationLevel and novelty:
- Strong visual design and premium unboxing experience
- Clear "before/after" narrative (problem → solution in seconds)
- Aspirational lifestyle angle (e.g., "ミニマリスト", "丁寧な暮らし", "旅好き")
When the product description or overseas campaign page exhibits these traits, bump japanValidationLevel by +0.05-0.10 as a qualitative signal even without a direct Makuake match.

### 3. Price Sensitivity Guidance
Use the following ranges to calibrate the priceFit axis more precisely for Japan CF:
- ¥3,000-¥15,000: Impulse-buy range. Easier to hit funding targets. Score 0.85-0.95.
- ¥15,000-¥50,000: Requires strong differentiation and compelling story. Score 0.55-0.75.
- ¥50,000+: Very niche. Requires proven overseas success (>500 backers or >$50k pledged) to justify. Score 0.2-0.45 unless overseas traction is exceptional.
- <¥3,000: Low margin, hard to cover fulfillment costs; score 0.2-0.35.
These override the default priceFit thresholds in the main rubric when more granular data is available.

### 4. Regulatory Risk — Japan-Specific Flags
Strengthen regulatoryRisk scoring with these Japan-specific rules:
- PSE (電気用品安全法): Required for electronics and electrical appliances sold in Japan. If the product is electronics and PSE compliance is NOT mentioned in the perplexity research or product description, treat as medium risk (score ≤ 0.5) and add a con note "PSE取得確認が必要".
- 技適 (Giteki mark): Required for wireless devices (Bluetooth, Wi-Fi, etc.) sold in Japan. If the product has wireless functionality and 技適 is not confirmed, treat as medium risk (score ≤ 0.5).
- Hard cap: If perplexity research explicitly identifies a regulatory blocker (e.g., unresolvable PSE/薬機法/景表法 conflict, import ban), cap the overall totalScore at 0.40 and set verdict to "reject" regardless of other axis scores. Document this cap in rationale.

### 5. Evidence Quality Bonus
When evaluating the evidence array from perplexity research:
- If the evidence contains a reference to an actual Makuake, GREEN FUNDING, or CAMPFIRE campaign for a similar product that achieved >150% of its funding goal, treat this as a strong positive signal.
- If the evidence comes from Japanese product media (GetNavi, Gizmodo Japan, ROOMIE, Lifehacker Japan, 家電 Watch, Impress Watch), treat it as weaker but useful domestic demand context, not proof of crowdfunding success.
- Apply a score bump of +0.05 to +0.10 to the japanValidationLevel axis and note the specific campaign in rationale.
- This bonus stacks with the normal japanValidationLevel rubric but may not push any single axis above 1.0.`;

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
  if (s.productType) lines.push(`Product type: ${s.productType}`);
  if (s.physicalProductLikely !== undefined) {
    lines.push(`Physical product likely: ${s.physicalProductLikely}`);
  }
  if (s.exclusionReason) lines.push(`Exclusion reason: ${s.exclusionReason}`);
  if (s.keepa) lines.push(`Keepa: ${JSON.stringify(s.keepa)}`);
  if (s.sellersprite) lines.push(`SellerSprite: ${JSON.stringify(s.sellersprite)}`);
  if (s.overseas) lines.push(`Overseas signal: ${JSON.stringify(s.overseas)}`);
  if (s.japan) lines.push(`Japan availability signal: ${JSON.stringify(s.japan)}`);

  // Emit Perplexity market research as a clearly labeled block so the LLM
  // knows these are pre-fetched facts it should cite (not invent).
  if (s.perplexity) {
    const { evidence, ...rest } = s.perplexity;
    lines.push(`\n## Perplexity research (pre-fetched, use as evidence source)`);
    lines.push(JSON.stringify(rest, null, 2));
    if (evidence && evidence.length > 0) {
      lines.push(`\nPerplexity source URLs (cite these in the evidence array):`);
      evidence.forEach((e, i) => {
        lines.push(`  ${i + 1}. ${e.sourceUrl} — ${e.claim}: ${e.snippet.slice(0, 120)}`);
      });
    }
  }

  if (s.mentionSources && s.mentionSources.length > 0) {
    lines.push("");
    lines.push(
      `Cross-source signal: this candidate was found in ${s.mentionSources.length} sources → [${s.mentionSources.join(", ")}]. Suggested crossSourceMentions axis ≈ ${(s.crossSourceScore ?? 0).toFixed(2)}.`
    );
  }
  if (s.japan?.japanValidationLevel !== undefined) {
    lines.push(
      `Japan validation hint: japanValidationLevel ≈ ${s.japan.japanValidationLevel.toFixed(2)} (derived from Japan reference-source similarity).`
    );
  }

  return lines.join("\n");
}

export type ScoreCandidateResult = {
  productId: string;
  runId: string;
  output: ScoringOutput;
  enqueuedApprovalId: string | null;
};

function salesNextActionForScore(data: ScoringOutput, signals: CandidateSignals) {
  if (data.verdict === "reject") {
    return "現時点では販売候補から外し、類似カテゴリの別商品を確認";
  }
  const risk = signals.perplexity?.regulatoryRisk;
  if (risk === "high") {
    return "規制リスク、認証書類、日本販売可否を先に確認";
  }
  if (signals.overseas?.url) {
    return "メーカー連絡先、日本販売権、卸条件、サンプル可否を確認";
  }
  return "一次ソースとメーカー連絡先を確認";
}

function shortlistMetadataFromScore(
  data: ScoringOutput,
  signals: CandidateSignals
) {
  const score100 = Math.round(data.score * 100);
  const priority =
    data.verdict === "reject"
      ? 0
      : Math.max(1, Math.min(9, Math.round(data.score * 9)));
  return {
    shortlist: {
      score: score100,
      rawScore: data.score,
      totalScore: data.totalScore,
      verdict: data.verdict,
      reasons: data.pros,
      risks: data.cons,
      nextAction: salesNextActionForScore(data, signals),
      japanAngle:
        signals.japan?.searchSummary ??
        signals.perplexity?.summary ??
        "日本クラウドファンディングで需要・差別化を検証",
      source: signals.overseas?.source,
      sourceUrl: signals.overseas?.url,
    },
    salesReadiness: {
      priority,
      reasons: data.pros,
      risks: data.cons,
      nextAction: salesNextActionForScore(data, signals),
      score: score100,
      rawScore: data.score,
    },
  };
}

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
  const storedSignals = meta.signals ?? {};
  const signals: CandidateSignals = {
    asin: row.asin ?? undefined,
    jan: row.jan ?? undefined,
    title: row.title,
    category: storedSignals.category ?? meta.category,
    productType: storedSignals.productType,
    physicalProductLikely: storedSignals.physicalProductLikely,
    exclusionReason: storedSignals.exclusionReason,
    keepa: storedSignals.keepa,
    sellersprite: storedSignals.sellersprite,
    perplexity: storedSignals.perplexity,
    overseas: storedSignals.overseas,
    japan: storedSignals.japan,
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
  const signals = normalizeSignals(CandidateSignalsSchema.parse(rawSignals));

  const product = await findOrCreateProduct({
    title: signals.title,
    asin: signals.asin,
    jan: signals.jan,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: { signals },
  });
  await mergeProductMetadata(product.id, { signals });

  const [activePrompt, attachedSkills] = await Promise.all([
    getActivePrompt(AGENT_ID),
    getAttachedSkills(AGENT_ID),
  ]);
  const basePrompt = activePrompt?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const scopedBasePrompt = activePrompt
    ? `${basePrompt}\n\n${PHYSICAL_PRODUCT_POLICY_PROMPT}`
    : basePrompt;
  const systemPrompt = composeSystemPrompt(scopedBasePrompt, attachedSkills);

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
    const forcedRejection = nonPhysicalRejection(signals);
    // Scoring is deterministic: no web_search. All market data comes from the
    // upstream Perplexity research stage (stored in signals.perplexity.evidence).
    // This ensures the same product always gets the same score given identical
    // signals (reproducibility guarantee).
    const scoringProvider = resolveScoutClaudeProvider("SCOUT_SCORING_PROVIDER");
    const { data: rawData, usage, provider, model } = forcedRejection
      ? {
          data: forcedRejection as unknown,
          usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
          provider: "mock" as const,
          model: "physical-product-gate",
        }
      : await runStructured({
          system: systemPrompt,
          user: userPromptFromSignals(signals, fewShots),
          schema: ScoringOutputSchema,
          // Mock returns the full Phase-B ScoringOutput; cast through unknown
          // so the schema-inferred (looser) type accepts it.
          mock: () => mockScore(signals) as unknown as z.infer<typeof ScoringOutputSchema>,
          provider: scoringProvider,
          model: modelForProvider(
            scoringProvider,
            process.env.SCOUT_SCORING_MODEL ?? SONNET_MODEL,
            "SCOUT_SCORING_PERPLEXITY_MODEL"
          ),
          // webSearch intentionally omitted — scoring must be deterministic.
        });

    // Run our backward-compat normalizer. If the LLM emitted invalid output,
    // parseScoringOutput synthesizes a reject so the pipeline never crashes.
    const data: ScoringOutput = parseScoringOutput(rawData);
    await mergeProductMetadata(product.id, shortlistMetadataFromScore(data, signals));

    await recordAutoEvaluation({
      runId: run.id,
      productId: product.id,
      verdict: data.verdict,
      score: data.score,
      reasoning: data.rationale,
      evidence: {
        pros: data.pros,
        cons: data.cons,
        provider,
        model,
        productType: signals.productType,
        physicalProductLikely: signals.physicalProductLikely,
        exclusionReason: signals.exclusionReason,
        axisScores: data.axisScores,
        citations: data.evidence,
        mentionSources: signals.mentionSources ?? [],
        japanValidationLevel: signals.japan?.japanValidationLevel ?? null,
      },
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
      const [existingOpen] = await db
        .select({ id: approvalQueue.id })
        .from(approvalQueue)
        .where(
          and(
            eq(approvalQueue.productId, product.id),
            isNull(approvalQueue.decision)
          )
        )
        .limit(1);

      if (existingOpen) {
        enqueuedApprovalId = existingOpen.id;
      } else {
        const item = await enqueueApproval({
          runId: run.id,
          productId: product.id,
          priority: data.suggestedPriority,
          requiredRole: "reviewer",
        });
        enqueuedApprovalId = item.id;
      }
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
