import { z } from "zod";

// ---------------------------------------------------------------------------
// Model name constants
// ---------------------------------------------------------------------------

/** Cheap, fast model for simple classification / pre-filter tasks. */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
/** Default production model for scoring and synthesis. */
export const SONNET_MODEL = "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LLMProvider = "mock" | "anthropic" | "perplexity" | "openai";

export type LLMUsage = {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearchRequests?: number;
};

export type StructuredCallOptions<T> = {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Override provider. Defaults to LLM_PROVIDER env or "mock". */
  provider?: LLMProvider;
  /** Bypass LLM_PROVIDER=mock for explicit production smoke checks. */
  forceProvider?: boolean;
  /** Override model within the chosen provider. */
  model?: string;
  /** Mock generator used when provider resolves to "mock". */
  mock?: () => T;
  /** Enable Claude's server-side web search tool. Off by default. */
  webSearch?: boolean;
  /** Max Claude web searches per request. */
  webSearchMaxUses?: number;
};

export type StructuredCallResult<T> = {
  data: T;
  usage: LLMUsage;
  provider: LLMProvider;
  model: string;
};

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_WEB_SEARCH_TOOL_VERSION = "web_search_20250305";
const RETRYABLE_ANTHROPIC_STATUSES = new Set([
  408,
  409,
  429,
  500,
  502,
  503,
  504,
]);

export function hasAnthropicApiKey() {
  return Boolean(
    (process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY)?.trim()
  );
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective provider. When LLM_PROVIDER=mock the global mock flag
 * wins over any per-call override so dev runs stay cost-free. Perplexity is
 * auto-degraded to mock when PERPLEXITY_API_KEY is missing.
 */
function resolveProvider(
  override?: LLMProvider,
  forceProvider = false
): LLMProvider {
  const env = (process.env.LLM_PROVIDER ?? "") as LLMProvider;

  // Global mock wins over everything — keeps dev safe.
  if (env === "mock" && !forceProvider) return "mock";

  const effective = override ?? env;

  if (effective === "perplexity") {
    if (!process.env.PERPLEXITY_API_KEY) {
      console.warn(
        "[llm] PERPLEXITY_API_KEY not set — auto-degrading to mock for this call"
      );
      return "mock";
    }
    return "perplexity";
  }

  if (effective === "anthropic" || effective === "openai") return effective;

  return "mock"; // unknown or empty env → safe fallback
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsvEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildAnthropicBetaHeader() {
  const headers = [
    "prompt-caching-2024-07-31",
    ...parseCsvEnv(process.env.ANTHROPIC_BETA_HEADERS),
  ];
  return Array.from(new Set(headers)).join(",");
}

function modelRejectsNonDefaultSampling(model: string) {
  return (
    model.startsWith("claude-fable-5") ||
    model.startsWith("claude-mythos-5") ||
    model.startsWith("claude-mythos-preview") ||
    model.startsWith("claude-opus-4-8") ||
    model.startsWith("claude-opus-4-7")
  );
}

function buildAnthropicOutputConfig() {
  const effort = process.env.ANTHROPIC_EFFORT?.trim();
  if (!effort) return undefined;
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    console.warn(`[llm] ignoring unsupported ANTHROPIC_EFFORT=${effort}`);
    return undefined;
  }
  return { effort };
}

function getAnthropicApiKey() {
  return process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY;
}

// ---------------------------------------------------------------------------
// Shared JSON extraction
// ---------------------------------------------------------------------------

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("LLM returned an empty response");

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`LLM returned non-JSON: ${trimmed.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Claude) — with Prompt Caching
// ---------------------------------------------------------------------------

/**
 * Compute the actual USD cost from the Anthropic usage block, accounting for
 * prompt-caching token tiers:
 *   - normal input:      $INPUT_USD/1M  (defaults $3)
 *   - cache write:       $INPUT_USD × 1.25/1M  (Anthropic's published rate)
 *   - cache read:        $INPUT_USD × 0.10/1M  (90% discount)
 *   - output:            $OUTPUT_USD/1M (defaults $15)
 *   - web search:        $WEB_SEARCH_USD/1K requests (defaults $10)
 */
function estimateAnthropicCostUsd(
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
  webSearchRequests: number
): number {
  const inPer1m = Number(process.env.ANTHROPIC_INPUT_USD_PER_1M ?? "3");
  const outPer1m = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_1M ?? "15");
  const searchPer1k = Number(process.env.ANTHROPIC_WEB_SEARCH_USD_PER_1K ?? "10");

  return (
    (inputTokens / 1_000_000) * inPer1m +
    (cacheWriteTokens / 1_000_000) * inPer1m * 1.25 +
    (cacheReadTokens / 1_000_000) * inPer1m * 0.1 +
    (outputTokens / 1_000_000) * outPer1m +
    (webSearchRequests / 1_000) * searchPer1k
  );
}

function buildAnthropicTools(opts: StructuredCallOptions<unknown>) {
  if (!opts.webSearch) return undefined;
  if (process.env.ANTHROPIC_ENABLE_WEB_SEARCH === "0") return undefined;

  const maxUses =
    opts.webSearchMaxUses ??
    Number(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES ?? "5");
  const toolVersion =
    process.env.ANTHROPIC_WEB_SEARCH_TOOL_VERSION ??
    DEFAULT_WEB_SEARCH_TOOL_VERSION;
  const responseInclusion =
    process.env.ANTHROPIC_WEB_SEARCH_RESPONSE_INCLUSION === "excluded" ||
    process.env.ANTHROPIC_WEB_SEARCH_RESPONSE_INCLUSION === "full"
      ? process.env.ANTHROPIC_WEB_SEARCH_RESPONSE_INCLUSION
      : undefined;

  return [
    {
      type: toolVersion,
      name: "web_search",
      max_uses: maxUses,
      user_location: {
        type: "approximate",
        city: "Tokyo",
        region: "Tokyo",
        country: "JP",
        timezone: "Asia/Tokyo",
      },
      ...(toolVersion >= "web_search_20260318" && responseInclusion
        ? { response_inclusion: responseInclusion }
        : {}),
    },
  ];
}

type AnthropicContentItem = {
  type?: string;
  text?: string;
  citations?: Array<{
    type?: string;
    url?: string;
    title?: string;
    cited_text?: string;
  }>;
  content?: unknown;
};

type AnthropicResponseBody = {
  content?: AnthropicContentItem[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: {
      web_search_requests?: number;
      web_fetch_requests?: number;
    };
  };
};

type CollectedCitation = {
  url: string;
  title?: string;
  snippet?: string;
};

function collectAnthropicCitations(body: AnthropicResponseBody) {
  const citations: CollectedCitation[] = [];
  const toolErrors: string[] = [];

  for (const item of body.content ?? []) {
    for (const cit of item.citations ?? []) {
      if (cit.url) {
        citations.push({
          url: cit.url,
          title: cit.title,
          snippet: cit.cited_text,
        });
      }
    }

    if (item.type !== "web_search_tool_result") continue;
    const content = item.content;
    const blocks = Array.isArray(content) ? content : content ? [content] : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const typed = block as {
        type?: string;
        url?: string;
        title?: string;
        page_age?: string;
        error_code?: string;
      };
      if (typed.type === "web_search_result" && typed.url) {
        citations.push({
          url: typed.url,
          title: typed.title,
          snippet: typed.page_age
            ? `${typed.title ?? typed.url} (${typed.page_age})`
            : typed.title,
        });
      }
      if (typed.type === "web_search_tool_result_error") {
        toolErrors.push(typed.error_code ?? "unknown_web_search_error");
      }
    }
  }

  return { citations, toolErrors };
}

function mergeEvidence(
  parsedJson: unknown,
  collectedCitations: CollectedCitation[]
) {
  if (
    !parsedJson ||
    typeof parsedJson !== "object" ||
    Array.isArray(parsedJson) ||
    collectedCitations.length === 0
  ) {
    return;
  }

  const obj = parsedJson as Record<string, unknown>;
  const existing = Array.isArray(obj.evidence) ? obj.evidence : [];
  const existingUrls = new Set(
    existing
      .map((e) =>
        e && typeof e === "object"
          ? (e as { sourceUrl?: string }).sourceUrl
          : null
      )
      .filter((u): u is string => Boolean(u))
  );
  const extra = collectedCitations
    .filter((c) => !existingUrls.has(c.url))
    .map((c) => ({
      claim: c.title ?? "Claude web_search citation",
      sourceUrl: c.url,
      snippet: (c.snippet ?? c.title ?? c.url).slice(0, 400),
    }));
  if (extra.length > 0) {
    obj.evidence = [...existing, ...extra];
  }
}

async function fetchAnthropicWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (
        response.ok ||
        attempt >= maxRetries ||
        !RETRYABLE_ANTHROPIC_STATUSES.has(response.status)
      ) {
        return response;
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      await response.text().catch(() => "");
      await sleep(waitMs);
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt >= maxRetries) break;
      await sleep(500 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Anthropic request failed before receiving a response");
}

async function runAnthropic<T>(
  opts: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=mock or provide ANTHROPIC_API_KEY (or CLAUDE_API_KEY)."
    );
  }

  const model =
    opts.model ?? process.env.ANTHROPIC_DEFAULT_MODEL ?? SONNET_MODEL;
  const baseUrl =
    process.env.ANTHROPIC_API_BASE?.replace(/\/$/, "") ??
    DEFAULT_ANTHROPIC_BASE_URL;
  const maxTokens = positiveNumber(process.env.ANTHROPIC_MAX_TOKENS, 4096);
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0.2");
  const timeoutMs = positiveNumber(
    process.env.ANTHROPIC_REQUEST_TIMEOUT_MS,
    120_000
  );
  const maxRetries = Math.floor(
    positiveNumber(process.env.ANTHROPIC_MAX_RETRIES, 2)
  );
  const tools = buildAnthropicTools(opts as StructuredCallOptions<unknown>);
  const outputConfig = buildAnthropicOutputConfig();

  // Prompt Caching: wrapping the system prompt in an array with cache_control
  // tells Anthropic to cache this prefix. Subsequent calls with the same
  // system prompt pay only 10% of normal input cost for cache reads. The beta
  // header enables the feature.
  const systemBlock = [
    {
      type: "text" as const,
      text: opts.system,
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const jsonInstruction =
    "Return valid JSON only. Do not wrap it in Markdown fences. " +
    (opts.webSearch
      ? "When the schema has an `evidence` array, every factual claim MUST have a corresponding entry with a real sourceUrl."
      : "Do not include prose outside the JSON object.");

  const requestBody = {
    model,
    max_tokens: maxTokens,
    ...(Number.isFinite(temperature) && !modelRejectsNonDefaultSampling(model)
      ? { temperature }
      : {}),
    ...(outputConfig ? { output_config: outputConfig } : {}),
    system: systemBlock,
    ...(tools ? { tools } : {}),
    messages: [
      {
        role: "user",
        content: `${opts.user}\n\n${jsonInstruction}`,
      },
    ],
  };

  const response = await fetchAnthropicWithRetry(
    `${baseUrl}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version":
          process.env.ANTHROPIC_VERSION ?? DEFAULT_ANTHROPIC_VERSION,
        "anthropic-beta": buildAnthropicBetaHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    timeoutMs,
    maxRetries
  );

  if (!response.ok) {
    const body = await response.text();
    const requestId = response.headers.get("request-id");
    throw new Error(
      `Anthropic request failed: ${response.status}${
        requestId ? ` request-id=${requestId}` : ""
      } ${body.slice(0, 500)}`
    );
  }

  const body = (await response.json()) as AnthropicResponseBody;

  const text =
    body.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? "";

  const { citations: collectedCitations, toolErrors } =
    collectAnthropicCitations(body);

  if (body.stop_reason === "refusal") {
    throw new Error("Anthropic refused the request. Review the prompt and input.");
  }
  if (body.stop_reason === "model_context_window_exceeded") {
    throw new Error(
      "Anthropic context window exceeded. Reduce input size or use a larger-context model."
    );
  }
  if (!text && toolErrors.length > 0) {
    throw new Error(
      `Anthropic web_search failed before producing text: ${toolErrors.join(", ")}`
    );
  }

  const parsedJson = extractJson(text);
  mergeEvidence(parsedJson, collectedCitations);

  const data = opts.schema.parse(parsedJson);

  const tokensIn = body.usage?.input_tokens ?? 0;
  const tokensOut = body.usage?.output_tokens ?? 0;
  const cacheWriteTokens = body.usage?.cache_creation_input_tokens ?? 0;
  const cacheReadTokens = body.usage?.cache_read_input_tokens ?? 0;
  const webSearchRequests =
    body.usage?.server_tool_use?.web_search_requests ?? 0;

  const costUsd = estimateAnthropicCostUsd(
    tokensIn,
    tokensOut,
    cacheWriteTokens,
    cacheReadTokens,
    webSearchRequests
  );

  return {
    data,
    usage: {
      tokensIn,
      tokensOut,
      costUsd,
      cacheReadTokens,
      cacheWriteTokens,
      webSearchRequests,
    },
    provider: "anthropic",
    model,
  };
}

// ---------------------------------------------------------------------------
// Perplexity (sonar) — dedicated market research provider
// ---------------------------------------------------------------------------

/**
 * Perplexity sonar pricing (publish rates, overridable via env):
 *   sonar-pro: $3/1M input + $15/1M output  (includes web search)
 *   sonar:     $1/1M input + $1/1M output
 *
 * Unlike Anthropic's web_search, citations come back as a top-level array of
 * URLs alongside the text response; we merge them into `evidence` automatically.
 */
function estimatePerplexityCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string
): number {
  const isSonarPro = model.includes("pro");
  const inPer1m = isSonarPro
    ? Number(process.env.PERPLEXITY_INPUT_USD_PER_1M ?? "3")
    : Number(process.env.PERPLEXITY_INPUT_USD_PER_1M_BASIC ?? "1");
  const outPer1m = isSonarPro
    ? Number(process.env.PERPLEXITY_OUTPUT_USD_PER_1M ?? "15")
    : Number(process.env.PERPLEXITY_OUTPUT_USD_PER_1M_BASIC ?? "1");

  return (
    (inputTokens / 1_000_000) * inPer1m +
    (outputTokens / 1_000_000) * outPer1m
  );
}

async function runPerplexity<T>(
  opts: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const apiKey = process.env.PERPLEXITY_API_KEY!;
  const model =
    opts.model ?? process.env.PERPLEXITY_DEFAULT_MODEL ?? "sonar-pro";
  const baseUrl = "https://api.perplexity.ai";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        {
          role: "user",
          content:
            opts.user +
            "\n\nReturn valid JSON only. No markdown fences. No prose outside the JSON object.",
        },
      ],
      // Ask Perplexity to return structured JSON
      response_format: { type: "json_object" },
      // Focus search on recent content (last month)
      search_recency_filter: "month",
      // Always return citations so we can populate the evidence field
      return_citations: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Perplexity request failed: ${response.status} ${body.slice(0, 300)}`
    );
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    citations?: string[];
  };

  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  const citations: string[] = body.citations ?? [];

  const parsedJson = extractJson(text);

  // Merge Perplexity citations into the evidence field when the schema shape
  // supports it (object with an `evidence` array). Silent if not compatible.
  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson) &&
    citations.length > 0
  ) {
    const obj = parsedJson as Record<string, unknown>;
    const existing = Array.isArray(obj.evidence) ? obj.evidence : [];
    const existingUrls = new Set(
      existing
        .map((e) =>
          e && typeof e === "object"
            ? (e as { sourceUrl?: string }).sourceUrl
            : null
        )
        .filter((u): u is string => Boolean(u))
    );
    const extra = citations
      .filter((url) => !existingUrls.has(url))
      .map((url) => ({
        claim: "Perplexity cited source",
        sourceUrl: url,
        snippet: url,
      }));
    if (extra.length > 0) {
      obj.evidence = [...existing, ...extra];
    }
  }

  const data = opts.schema.parse(parsedJson);

  const tokensIn = body.usage?.prompt_tokens ?? 0;
  const tokensOut = body.usage?.completion_tokens ?? 0;
  const costUsd = estimatePerplexityCostUsd(tokensIn, tokensOut, model);

  return {
    data,
    usage: { tokensIn, tokensOut, costUsd },
    provider: "perplexity",
    model,
  };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Call an LLM and return a Zod-validated structured response.
 *
 * Provider resolution (in priority order):
 *  1. LLM_PROVIDER=mock  → always mock (safe default in dev/CI)
 *  2. opts.provider       → caller-specified provider
 *  3. LLM_PROVIDER env    → global default
 *  4. fallback            → mock
 *
 * Perplexity auto-degrades to mock if PERPLEXITY_API_KEY is unset.
 */
export async function runStructured<T>(
  opts: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const provider = resolveProvider(opts.provider, opts.forceProvider);

  if (provider === "mock") {
    if (!opts.mock) {
      throw new Error(
        "LLM provider resolved to 'mock' but no mock() generator was supplied"
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

  if (provider === "perplexity") {
    return runPerplexity(opts);
  }

  if (provider === "anthropic") {
    return runAnthropic(opts);
  }

  throw new Error(
    `LLM provider "${provider}" is not implemented. Set LLM_PROVIDER=mock or anthropic.`
  );
}
