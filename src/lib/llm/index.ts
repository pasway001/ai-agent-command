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

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective provider. When LLM_PROVIDER=mock the global mock flag
 * wins over any per-call override so dev runs stay cost-free. Perplexity is
 * auto-degraded to mock when PERPLEXITY_API_KEY is missing.
 */
function resolveProvider(override?: LLMProvider): LLMProvider {
  const env = (process.env.LLM_PROVIDER ?? "") as LLMProvider;

  // Global mock wins over everything — keeps dev safe.
  if (env === "mock") return "mock";

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

  return [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxUses,
      user_location: {
        type: "approximate",
        city: "Tokyo",
        region: "Tokyo",
        country: "JP",
        timezone: "Asia/Tokyo",
      },
    },
  ];
}

async function runAnthropic<T>(
  opts: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=mock or provide the key."
    );
  }

  const model =
    opts.model ?? process.env.ANTHROPIC_DEFAULT_MODEL ?? SONNET_MODEL;
  const baseUrl =
    process.env.ANTHROPIC_API_BASE?.replace(/\/$/, "") ??
    "https://api.anthropic.com";
  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? "4096");
  const temperature = Number(process.env.ANTHROPIC_TEMPERATURE ?? "0.2");
  const tools = buildAnthropicTools(opts as StructuredCallOptions<unknown>);

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
    "Every factual claim MUST have a corresponding entry in the `evidence` array with a real sourceUrl.";

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemBlock,
      ...(tools ? { tools } : {}),
      messages: [
        {
          role: "user",
          content: `${opts.user}\n\n${jsonInstruction}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Anthropic request failed: ${response.status} ${body.slice(0, 300)}`
    );
  }

  type AnthropicContentItem = {
    type?: string;
    text?: string;
    citations?: Array<{ url?: string; title?: string; cited_text?: string }>;
  };

  const body = (await response.json()) as {
    content?: AnthropicContentItem[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      server_tool_use?: { web_search_requests?: number };
    };
  };

  const text =
    body.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? "";

  // Collect inline citations from web_search and hoist them into evidence
  const collectedCitations: Array<{
    url: string;
    title?: string;
    snippet?: string;
  }> = [];
  for (const item of body.content ?? []) {
    for (const cit of item.citations ?? []) {
      if (cit.url) {
        collectedCitations.push({
          url: cit.url,
          title: cit.title,
          snippet: cit.cited_text,
        });
      }
    }
  }

  const parsedJson = extractJson(text);
  if (
    parsedJson &&
    typeof parsedJson === "object" &&
    !Array.isArray(parsedJson) &&
    collectedCitations.length > 0
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
    const extra = collectedCitations
      .filter((c) => !existingUrls.has(c.url))
      .map((c) => ({
        claim: c.title ?? "web_search citation",
        sourceUrl: c.url,
        snippet: (c.snippet ?? c.title ?? c.url).slice(0, 400),
      }));
    if (extra.length > 0) {
      obj.evidence = [...existing, ...extra];
    }
  }

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
  const provider = resolveProvider(opts.provider);

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
