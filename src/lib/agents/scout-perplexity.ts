import { z } from "zod";
import { findOrCreateProduct, mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";
import type { WatchlistItem } from "./scout-keepa";

export const AGENT_ID = "scout.perplexity_jp_market";

export const DEFAULT_SYSTEM_PROMPT = `You are a Claude-powered Japan market research agent.
Research the Japanese market for one product candidate using web search when available.
Focus on Amazon Japan, Rakuten, Yahoo Shopping, Makuake/GREEN FUNDING/CAMPFIRE prior art,
and obvious regulatory risks such as medical claims, beauty claims, food/supplement claims,
PSE, radio law, and consumer safety.

Return JSON: { domesticDemandTrend, regulatoryRisk, summary }.
Use rising / flat / declining for trend, and low / medium / high for regulatory risk.
The summary is a short Japanese sentence with the strongest evidence and at least one source URL if search was used.`;

const PerplexityOutputSchema = z.object({
  domesticDemandTrend: z.enum(["rising", "flat", "declining"]),
  regulatoryRisk: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});
export type PerplexityOutput = z.infer<typeof PerplexityOutputSchema>;

const REGULATED_KEYWORDS = [
  "ダイエット",
  "サプリ",
  "美白",
  "薬用",
  "シャンプー",
  "化粧品",
];

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mockPerplexity(item: WatchlistItem): PerplexityOutput {
  const seed = hashStr(`px:${item.title}`);
  const trends: PerplexityOutput["domesticDemandTrend"][] = [
    "rising",
    "rising",
    "flat",
    "declining",
  ];
  const trend = trends[seed % trends.length];

  const isRegulated = REGULATED_KEYWORDS.some((k) => item.title.includes(k));
  const risk: PerplexityOutput["regulatoryRisk"] = isRegulated
    ? (seed >>> 3) % 3 === 0
      ? "high"
      : "medium"
    : "low";

  const summary = isRegulated
    ? "国内需要は安定しているが、薬機法・景表法での表現規制に注意が必要。"
    : trend === "rising"
      ? "国内ECで需要が拡大しており、参入余地あり。"
      : trend === "declining"
        ? "コモディティ化が進み価格競争が激化している。"
        : "需要は横ばい。差別化要素が必要。";

  return { domesticDemandTrend: trend, regulatoryRisk: risk, summary };
}

export async function runPerplexityForItem(item: WatchlistItem) {
  const product = await findOrCreateProduct({
    asin: item.asin,
    title: item.title,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: { category: item.category },
  });

  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId: product.id,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    user: `ASIN: ${item.asin}\nTitle: ${item.title}${
      item.category ? `\nCategory: ${item.category}` : ""
    }`,
    schema: PerplexityOutputSchema,
    mock: () => mockPerplexity(item),
    inputPayload: { asin: item.asin },
    webSearch: true,
    webSearchMaxUses: 3,
  });

  await mergeProductMetadata(product.id, {
    signals: { perplexity: outcome.data },
  });

  return { product, outcome };
}

export async function runPerplexityResearch(watchlist: WatchlistItem[]) {
  const results = [];
  for (const item of watchlist) {
    results.push(await runPerplexityForItem(item));
  }
  return results;
}
