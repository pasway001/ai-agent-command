import { z } from "zod";

export type LLMProvider = "mock" | "anthropic" | "openai";

export type LLMUsage = {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

export type StructuredCallOptions<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Override provider for this call. Defaults to env LLM_PROVIDER or "mock". */
  provider?: LLMProvider;
  /** Override model. */
  model?: string;
  /** Mock generator (used when provider="mock" and no LLM_PROVIDER env). */
  mock?: () => T;
};

export type StructuredCallResult<T> = {
  data: T;
  usage: LLMUsage;
  provider: LLMProvider;
  model: string;
};

function getProvider(override?: LLMProvider): LLMProvider {
  if (override) return override;
  const env = process.env.LLM_PROVIDER as LLMProvider | undefined;
  if (env === "anthropic" || env === "openai" || env === "mock") return env;
  return "mock";
}

/**
 * Call an LLM and parse a structured response with a Zod schema.
 *
 * The provider is pluggable: in dev we use "mock" which calls `opts.mock()`.
 * Once an API key is wired up (LLM_PROVIDER=anthropic or openai), the same
 * call site starts hitting the real model with no agent code changes.
 */
export async function runStructured<T>(
  opts: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const provider = getProvider(opts.provider);

  if (provider === "mock") {
    if (!opts.mock) {
      throw new Error(
        "LLM provider is 'mock' but no mock() generator was supplied"
      );
    }
    const data = opts.schema.parse(opts.mock());
    return {
      data,
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      provider,
      model: "mock",
    };
  }

  // Real providers will be implemented when API keys are available.
  // Anthropic: use @anthropic-ai/sdk with tool_use schema or JSON mode.
  // OpenAI: use openai SDK with response_format: { type: "json_schema" }.
  throw new Error(
    `LLM provider "${provider}" is not implemented yet. Set LLM_PROVIDER=mock or add the SDK.`
  );
}
