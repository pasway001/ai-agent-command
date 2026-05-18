import { z } from "zod";

export type LLMProvider = "mock" | "anthropic" | "openai";

export type LLMUsage = {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  webSearchRequests?: number;
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
  /** Enable Claude's server-side web search tool for research agents only. */
  webSearch?: boolean;
  /** Max Claude web searches in this single request. */
  webSearchMaxUses?: number;
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

function estimateAnthropicCostUsd(inputTokens: number, outputTokens: number) {
  const inputUsdPer1m = Number(process.env.ANTHROPIC_INPUT_USD_PER_1M ?? "3");
  const outputUsdPer1m = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_1M ?? "15");
  return (
    (inputTokens / 1_000_000) * inputUsdPer1m +
    (outputTokens / 1_000_000) * outputUsdPer1m
  );
}

function estimateWebSearchCostUsd(searchRequests: number) {
  const searchUsdPer1k = Number(
    process.env.ANTHROPIC_WEB_SEARCH_USD_PER_1K ?? "10"
  );
  return (searchRequests / 1_000) * searchUsdPer1k;
}

function buildAnthropicTools(opts: StructuredCallOptions<unknown>) {
  if (!opts.webSearch) return undefined;
  if (process.env.ANTHROPIC_ENABLE_WEB_SEARCH !== "1") return undefined;

  const maxUses =
    opts.webSearchMaxUses ??
    Number(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES ?? "3");

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
      "ANTHROPIC_API_KEY is missing. Set LLM_PROVIDER=mock or provide the Claude API key."
    );
  }

  const model =
    opts.model ?? process.env.ANTHROPIC_DEFAULT_MODEL ?? "claude-sonnet-4-6";
  const baseUrl =
    process.env.ANTHROPIC_API_BASE?.replace(/\/$/, "") ??
    "https://api.anthropic.com";
  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS ?? "1024");
  const tools = buildAnthropicTools(opts as StructuredCallOptions<unknown>);

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      ...(tools ? { tools } : {}),
      messages: [
        {
          role: "user",
          content:
            `${opts.user}\n\n` +
            "Return valid JSON only. Do not wrap it in Markdown. " +
            "When you use web search, include source URLs inside the JSON when the schema has a suitable field.",
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

  const body = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      server_tool_use?: { web_search_requests?: number };
    };
  };
  const text =
    body.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("")
      .trim() ?? "";

  const data = opts.schema.parse(extractJson(text));
  const tokensIn = body.usage?.input_tokens ?? 0;
  const tokensOut = body.usage?.output_tokens ?? 0;
  const webSearchRequests =
    body.usage?.server_tool_use?.web_search_requests ?? 0;
  const costUsd =
    estimateAnthropicCostUsd(tokensIn, tokensOut) +
    estimateWebSearchCostUsd(webSearchRequests);

  return {
    data,
    usage: {
      tokensIn,
      tokensOut,
      costUsd,
      webSearchRequests,
    },
    provider: "anthropic",
    model,
  };
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

  if (provider === "anthropic") {
    return runAnthropic(opts);
  }

  // OpenAI can be added later as a backup provider. It is intentionally not
  // required for the minimum-cost production path.
  throw new Error(
    `LLM provider "${provider}" is not implemented yet. Set LLM_PROVIDER=mock or add the SDK.`
  );
}
