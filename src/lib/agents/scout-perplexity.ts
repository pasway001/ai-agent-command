import { z } from "zod";
import { mergeProductMetadata, findOrCreateProduct } from "../agent-sdk";
import { runAgent } from "./_runner";
import { SONNET_MODEL } from "../llm";
import { modelForProvider, resolveScoutResearchProvider } from "./provider";

/**
 * Domestic market research agent (System 7).
 *
 * Architecture change from Phase B:
 *   BEFORE: used Claude web_search internally (~$0.03/product, non-reproducible)
 *   AFTER:  uses Claude Haiku + web_search (~$0.02/product with 3 searches, cached 7 days)
 *
 * Reproducibility: research results are cached in products.metadata.research
 * for RESEARCH_CACHE_DAYS days. The scoring stage (scout-scoring.ts) reads
 * these cached results deterministically — no live search during scoring.
 *
 * Two formerly-separate agents (jp_competitor_scan + makuake_prior_art) are
 * merged into a single Perplexity call to halve the API cost.
 */

export const AGENT_ID = "scout.perplexity_jp_market";

/** How many days to keep Perplexity research results before re-fetching. */
const RESEARCH_CACHE_DAYS = 7;

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const CompetitorItemSchema = z.object({
  name: z.string(),
  platform: z.string(),
  priceJpy: z.number().optional(),
  url: z.string().optional(),
  reviewNote: z.string().max(100).optional(),
});

const CampaignItemSchema = z.object({
  platform: z.enum(["makuake", "green_funding", "campfire", "other"]),
  title: z.string(),
  pledgedJpy: z.number().optional(),
  achievementPct: z.number().min(0).optional(),
  url: z.string().optional(),
});

export const JpMarketResearchSchema = z.object({
  jpCompetitors: z.object({
    count: z.number().int().min(0),
    priceRangeJpy: z.object({
      min: z.number().optional(),
      median: z.number().optional(),
      max: z.number().optional(),
    }),
    examples: z.array(CompetitorItemSchema).max(5).default([]),
  }),
  jpCFHistory: z.object({
    campaigns: z.array(CampaignItemSchema).max(5).default([]),
    successCount: z.number().int().min(0).default(0),
    totalFound: z.number().int().min(0).default(0),
  }),
  regulatoryFlags: z.array(
    z.object({
      law: z.string(),
      severity: z.enum(["none", "low", "medium", "high", "blocker"]),
      reason: z.string().max(200),
    })
  ).default([]),
  demandTrend: z.enum(["rising", "flat", "declining"]).default("flat"),
  summary: z.string().max(400),
  evidence: z.array(
    z.object({
      claim: z.string(),
      sourceUrl: z.string().url(),
      snippet: z.string().max(300),
    })
  ).default([]),
});

export type JpMarketResearch = z.infer<typeof JpMarketResearchSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT = `You are a Japan import-business market researcher specializing in crowdfunding product sourcing.
For the given product, use all 8 web searches with this strategy:

**検索戦略（8回を無駄なく使う）:**
• 検索 1-2: Amazon JP・楽天・Yahoo!ショッピング — 競合品の価格帯・レビュー数・出品者数
• 検索 3-4: Makuake・GREEN FUNDING・CAMPFIRE — 類似キャンペーンの達成率・調達総額・支援者数
• 検索 5-6: 日本消費者需要 — SNS言及数・季節需要・ターゲット層の特定
• 検索 7: 規制リスク詳細 — PSE認証要否・技適・薬機法・食品衛生法の具体的適用判断
• 検索 8: 輸入障壁 — 関税分類・一般的な輸入量・既存輸入業者の有無

Return structured JSON covering six areas:

1. jpCompetitors — similar products already sold in Japan (Amazon JP, Rakuten, Yahoo Shopping, Mercari).
   Focus on price range and review sentiment (not raw counts).

2. jpCFHistory — similar campaigns on Makuake, GREEN FUNDING, or CAMPFIRE.
   Include pledgedJpy (JPY total raised) and achievementPct (% of goal).

3. regulatoryFlags — potential Japan regulatory issues.
   Laws to check: 薬機法, 景表法, PSE, 電波法/技適, 食品衛生法.
   Only include flags that genuinely apply (empty array is fine).

4. demandTrend — overall Japan consumer demand: rising / flat / declining.

5. summary — 2–3 Japanese sentences with the most actionable insight for a CF import decision.
   Include the single biggest opportunity AND the single biggest risk.

6. evidence — EVERY claim must have a sourceUrl from your search.
   If no real URL is available for a claim, omit that claim rather than fabricating a URL.

Rules:
• Return strict JSON only. No prose, no markdown fences.
• priceRangeJpy in JPY (convert from USD/EUR at current rate if needed).
• achievementPct is a percentage where 100 = met the goal, 250 = 2.5x the goal.
• If genuinely no data is found, return empty arrays and say "情報なし" in summary.`;

// ---------------------------------------------------------------------------
// Mock (deterministic, hash-based)
// ---------------------------------------------------------------------------

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mockResearch(title: string): JpMarketResearch {
  const seed = hashStr(`jp:${title}`);
  const text = title.toLowerCase();

  const isRegulated =
    ["supplement", "beauty", "medical", "pharma", "サプリ", "美容", "医療"].some(
      (k) => text.includes(k)
    );

  const trends: JpMarketResearch["demandTrend"][] = ["rising", "rising", "flat", "declining"];
  const demandTrend = trends[seed % trends.length];

  const competitorCount = seed % 8;
  const priceMedian = 8000 + (seed % 20) * 1000;

  return {
    jpCompetitors: {
      count: competitorCount,
      priceRangeJpy: {
        min: priceMedian * 0.6,
        median: priceMedian,
        max: priceMedian * 1.8,
      },
      examples:
        competitorCount > 0
          ? [
              {
                name: `${title} 類似品 (モック)`,
                platform: "Amazon JP",
                priceJpy: priceMedian,
              },
            ]
          : [],
    },
    jpCFHistory: {
      campaigns:
        seed % 3 === 0
          ? [
              {
                platform: "makuake",
                title: `${title.slice(0, 20)} 風プロジェクト (モック)`,
                pledgedJpy: 3_500_000,
                achievementPct: 175,
              },
            ]
          : [],
      successCount: seed % 3 === 0 ? 1 : 0,
      totalFound: seed % 3 === 0 ? 1 : 0,
    },
    regulatoryFlags: isRegulated
      ? [
          {
            law: "薬機法",
            severity: "medium",
            reason: "美容・健康訴求を含む場合は表現規制に注意",
          },
        ]
      : [],
    demandTrend,
    summary: `モックデータ: 類似品${competitorCount}件、需要は${demandTrend}傾向。本番はPerplexityで実データを取得します。`,
    evidence: [],
  };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function isCacheValid(runAt: string | undefined): boolean {
  if (!runAt) return false;
  const ageMs = Date.now() - new Date(runAt).getTime();
  return ageMs < RESEARCH_CACHE_DAYS * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export type PerplexityResearchInput = {
  asin?: string | null;
  title: string;
  category?: string | null;
  shortDescription?: string | null;
  /** Force a fresh fetch even if cached data is still valid. */
  forceRefresh?: boolean;
};

export type PerplexityResearchResult = {
  productId: string;
  runId: string;
  research: JpMarketResearch;
  cached: boolean;
};

/**
 * Run Japan market research for a single product candidate.
 *
 * Uses Perplexity sonar-pro when PERPLEXITY_API_KEY is set, otherwise falls
 * back to a deterministic mock (safe for dev/CI without an API key).
 *
 * Results are cached in products.metadata.research for RESEARCH_CACHE_DAYS
 * days. The scout pipeline checks this cache before calling Perplexity.
 */
export async function runPerplexityResearch(
  input: PerplexityResearchInput
): Promise<PerplexityResearchResult> {
  const product = await findOrCreateProduct({
    asin: input.asin ?? undefined,
    title: input.title,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: { category: input.category },
  });

  // Return cached result when still fresh (avoids repeat API calls on the
  // same product across scout runs within the cache window).
  const existingMeta = (product.metadata ?? {}) as {
    research?: { runAt?: string; data?: JpMarketResearch };
  };
  if (
    !input.forceRefresh &&
    existingMeta.research?.runAt &&
    isCacheValid(existingMeta.research.runAt) &&
    existingMeta.research.data
  ) {
    return {
      productId: product.id,
      runId: "cached",
      research: existingMeta.research.data,
      cached: true,
    };
  }

  // Build a rich query for Perplexity. Combining competitor scan + CF history
  // + regulatory check in a single call cuts the API cost in half vs three
  // separate calls.
  const queryLines = [
    `Product: ${input.title}`,
    input.category ? `Category: ${input.category}` : null,
    input.shortDescription
      ? `Description: ${input.shortDescription.slice(0, 300)}`
      : null,
    "",
    "Search for this product or close alternatives in the Japanese market.",
    "Focus on Amazon Japan, Rakuten, Yahoo Shopping, Makuake, GREEN FUNDING, and CAMPFIRE.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const provider = resolveScoutResearchProvider("SCOUT_RESEARCH_PROVIDER");
  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId: product.id,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    user: queryLines,
    schema: JpMarketResearchSchema,
    provider,
    model: modelForProvider(
      provider,
      process.env.SCOUT_RESEARCH_MODEL ?? SONNET_MODEL,
      "SCOUT_RESEARCH_PERPLEXITY_MODEL"
    ),
    webSearch: true,
    webSearchMaxUses: Number(process.env.SCOUT_RESEARCH_WEB_SEARCH_MAX_USES ?? "8"),
    mock: () => mockResearch(input.title),
    inputPayload: { title: input.title, category: input.category },
  });

  // Persist results to product metadata with a timestamp for cache TTL.
  await mergeProductMetadata(product.id, {
    research: {
      runAt: new Date().toISOString(),
      data: outcome.data,
    },
    // Back-compat: keep the flat perplexity signals that scout-scoring reads.
    signals: {
      perplexity: {
        domesticDemandTrend: outcome.data.demandTrend,
        regulatoryRisk:
          outcome.data.regulatoryFlags.some((f) => f.severity === "blocker")
            ? "high"
            : outcome.data.regulatoryFlags.some(
                (f) => f.severity === "high" || f.severity === "medium"
              )
            ? "medium"
            : "low",
        summary: outcome.data.summary,
        // Include citation URLs so scout-scoring can cite them as evidence.
        evidence: outcome.data.evidence,
      },
    },
  });

  return {
    productId: product.id,
    runId: outcome.runId,
    research: outcome.data,
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// Batch helper (used by minimal-scout.ts)
// ---------------------------------------------------------------------------

export async function runPerplexityResearchBatch(
  items: PerplexityResearchInput[]
): Promise<PerplexityResearchResult[]> {
  // Sequential to respect Perplexity rate limits; add concurrency if needed.
  const results: PerplexityResearchResult[] = [];
  for (const item of items) {
    results.push(await runPerplexityResearch(item));
  }
  return results;
}
