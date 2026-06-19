import type { LLMProvider } from "../llm";

const PROVIDERS = new Set<LLMProvider>([
  "mock",
  "anthropic",
  "perplexity",
  "openai",
]);

function providerFromEnv(key: string): LLMProvider | null {
  const value = process.env[key]?.trim();
  if (!value) return null;
  if (PROVIDERS.has(value as LLMProvider)) return value as LLMProvider;
  console.warn(`[agents/provider] ignoring unsupported ${key}=${value}`);
  return null;
}

function globalMockEnabled() {
  return process.env.LLM_PROVIDER === "mock";
}

/**
 * Scout prefilter/scoring are Claude-shaped JSON tasks. Keep them on Anthropic
 * even when the research provider is Perplexity, otherwise Claude model names
 * get sent to the wrong API.
 */
export function resolveScoutClaudeProvider(envKey: string): LLMProvider {
  const explicit = providerFromEnv(envKey);
  if (explicit) return explicit;
  if (globalMockEnabled()) return "mock";
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock";
}

/**
 * Research can use either Perplexity sonar (preferred when configured) or
 * Claude web_search. It falls back to mock for local smoke tests.
 */
export function resolveScoutResearchProvider(envKey: string): LLMProvider {
  const explicit = providerFromEnv(envKey);
  if (explicit) return explicit;
  if (globalMockEnabled()) return "mock";
  if (process.env.PERPLEXITY_API_KEY) return "perplexity";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

export function modelForProvider(
  provider: LLMProvider,
  anthropicModel: string,
  perplexityEnvKey: string
) {
  if (provider === "perplexity") {
    return process.env[perplexityEnvKey] ?? process.env.PERPLEXITY_DEFAULT_MODEL ?? "sonar-pro";
  }
  return anthropicModel;
}
