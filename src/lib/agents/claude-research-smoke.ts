import { z } from "zod";
import {
  hasAnthropicApiKey,
  runStructured,
  SONNET_MODEL,
} from "../llm";
import {
  DEFAULT_SYSTEM_PROMPT,
  JpMarketResearchSchema,
} from "./scout-perplexity";

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
Prefer fewer, higher-quality searches. Return the full schema shape.`;
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
