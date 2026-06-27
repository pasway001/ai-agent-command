import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, agents } from "../db/schema";
import {
  hasAnthropicApiKey,
  runStructured,
  SONNET_MODEL,
} from "../llm";
import {
  DEFAULT_SYSTEM_PROMPT,
  JpMarketResearchSchema,
} from "./scout-perplexity";

export const CLAUDE_RESEARCH_SMOKE_AGENT_ID = "maintenance.claude_research_smoke";

export const ClaudeResearchSmokeInputSchema = z.object({
  title: z.string().min(1).max(160).default("Foldable portable espresso maker"),
  description: z
    .string()
    .max(600)
    .default(
      "A compact travel espresso maker for desk workers, campers, and gift buyers."
    ),
  sourceUrl: z.string().url().optional(),
  webSearchMaxUses: z.number().int().min(1).max(5).default(2),
});

export type ClaudeResearchSmokeInput = z.input<
  typeof ClaudeResearchSmokeInputSchema
>;

export type ClaudeResearchSmokeResult = {
  ok: true;
  provider: "anthropic";
  model: string;
  durationMs: number;
  usage: {
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    webSearchRequests?: number;
  };
  research: {
    demandTrend: string;
    goNoGo: string;
    confidence: string;
    summary: string;
    evidenceCount: number;
    firstEvidenceUrl: string | null;
    targetSegments: string[];
    makuakeAngle: string;
    certificationNeeds: string[];
  };
};

export type ClaudeResearchSmokeStoredStatus = {
  ok: boolean;
  hasRun: boolean;
  agentId: string;
  runId: string | null;
  status: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: ClaudeResearchSmokeResult | null;
};

function userPrompt(input: z.infer<typeof ClaudeResearchSmokeInputSchema>) {
  return [
    `Product: ${input.title}`,
    `Description: ${input.description}`,
    input.sourceUrl ? `Source URL: ${input.sourceUrl}` : null,
    "",
    "Run a minimal but real Japan-market research smoke check.",
    "Prioritize: Japanese competition, Makuake/CF fit, regulatory or certification risk, and one concrete customer segment.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function smokeSystemPrompt(maxUses: number) {
  return `${DEFAULT_SYSTEM_PROMPT}

Smoke-test constraint:
Use at most ${maxUses} web searches even if the normal research prompt mentions 8 searches.
Prefer fewer, higher-quality searches. Return the full schema shape, but keep it concise:
max 2 competitor examples, max 2 CF campaigns, max 3 evidence items, and short Japanese snippets.`;
}

export async function runClaudeResearchSmoke(
  rawInput: ClaudeResearchSmokeInput = {}
): Promise<ClaudeResearchSmokeResult> {
  if (!hasAnthropicApiKey()) {
    throw new Error("ANTHROPIC_API_KEY or CLAUDE_API_KEY is missing.");
  }

  const input = ClaudeResearchSmokeInputSchema.parse(rawInput);
  const startedAt = Date.now();
  const outcome = await runStructured({
    system: smokeSystemPrompt(input.webSearchMaxUses),
    user: userPrompt(input),
    schema: JpMarketResearchSchema,
    provider: "anthropic",
    forceProvider: true,
    model:
      process.env.SCOUT_RESEARCH_MODEL ??
      process.env.ANTHROPIC_DEFAULT_MODEL ??
      SONNET_MODEL,
    webSearch: true,
    webSearchMaxUses: input.webSearchMaxUses,
  });

  if (outcome.provider !== "anthropic") {
    throw new Error(`Expected anthropic provider, got ${outcome.provider}`);
  }

  return {
    ok: true,
    provider: "anthropic",
    model: outcome.model,
    durationMs: Date.now() - startedAt,
    usage: outcome.usage,
    research: {
      demandTrend: outcome.data.demandTrend,
      goNoGo: outcome.data.goNoGo,
      confidence: outcome.data.confidence,
      summary: outcome.data.summary,
      evidenceCount: outcome.data.evidence.length,
      firstEvidenceUrl: outcome.data.evidence[0]?.sourceUrl ?? null,
      targetSegments: outcome.data.marketSignals.targetSegments,
      makuakeAngle: outcome.data.positioning.makuakeAngle,
      certificationNeeds:
        outcome.data.importFeasibility.certificationNeeds,
    },
  };
}

function safeInput(input: z.infer<typeof ClaudeResearchSmokeInputSchema>) {
  return {
    title: input.title,
    description: input.description,
    sourceUrl: input.sourceUrl ?? null,
    webSearchMaxUses: input.webSearchMaxUses,
  };
}

function safeError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 1200 ? `${message.slice(0, 1200)}...` : message;
}

function isSmokeResult(value: unknown): value is ClaudeResearchSmokeResult {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.ok === true && record.provider === "anthropic";
}

async function ensureSmokeAgent() {
  await db
    .insert(agents)
    .values({
      id: CLAUDE_RESEARCH_SMOKE_AGENT_ID,
      name: "Claude Research Smoke",
      systemNo: 1,
      agentType: "scout",
      description: "Verifies that Japan-market product research can call Claude API.",
      enabled: true,
      concurrencyLimit: 1,
      isDynamic: false,
      signalKey: null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: "Claude Research Smoke",
        description: "Verifies that Japan-market product research can call Claude API.",
        enabled: true,
        updatedAt: new Date(),
      },
    });
}

export async function runAndRecordClaudeResearchSmoke(
  rawInput: ClaudeResearchSmokeInput = {}
) {
  const input = ClaudeResearchSmokeInputSchema.parse(rawInput);
  await ensureSmokeAgent();

  const [run] = await db
    .insert(agentRuns)
    .values({
      agentId: CLAUDE_RESEARCH_SMOKE_AGENT_ID,
      status: "running",
      inputPayload: safeInput(input),
      startedAt: new Date(),
    })
    .returning({ id: agentRuns.id });

  try {
    const result = await runClaudeResearchSmoke(input);
    await db
      .update(agentRuns)
      .set({
        status: "succeeded",
        outputPayload: result,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        costUsd: String(result.usage.costUsd),
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));
    await db
      .update(agents)
      .set({
        lastRunAt: new Date(),
        lastStatus: "succeeded",
        updatedAt: new Date(),
      })
      .where(eq(agents.id, CLAUDE_RESEARCH_SMOKE_AGENT_ID));

    return { runId: run.id, result };
  } catch (err) {
    const error = safeError(err);
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        errorMessage: error,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, run.id));
    await db
      .update(agents)
      .set({
        lastRunAt: new Date(),
        lastStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(agents.id, CLAUDE_RESEARCH_SMOKE_AGENT_ID));
    throw err;
  }
}

export async function getLatestClaudeResearchSmokeStatus(): Promise<ClaudeResearchSmokeStoredStatus> {
  const [row] = await db
    .select({
      id: agentRuns.id,
      status: agentRuns.status,
      outputPayload: agentRuns.outputPayload,
      errorMessage: agentRuns.errorMessage,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
    })
    .from(agentRuns)
    .where(eq(agentRuns.agentId, CLAUDE_RESEARCH_SMOKE_AGENT_ID))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);

  if (!row) {
    return {
      ok: false,
      hasRun: false,
      agentId: CLAUDE_RESEARCH_SMOKE_AGENT_ID,
      runId: null,
      status: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    };
  }

  const result = isSmokeResult(row.outputPayload) ? row.outputPayload : null;
  return {
    ok: row.status === "succeeded" && result !== null,
    hasRun: true,
    agentId: CLAUDE_RESEARCH_SMOKE_AGENT_ID,
    runId: row.id,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.errorMessage,
    result,
  };
}
