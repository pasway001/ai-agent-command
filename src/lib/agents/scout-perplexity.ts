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

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of [
    "segment",
    "target",
    "name",
    "title",
    "label",
    "value",
    "description",
    "reason",
    "claim",
    "text",
    "summary",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const normalized = value.replace(/[¥￥,\s円%]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function boundedText(max: number) {
  return z.preprocess((value) => textFromUnknown(value), z.string().max(max));
}

function boundedTextArray(maxItems: number, maxChars: number) {
  return z
    .preprocess(
      (value) => {
        const values = Array.isArray(value) ? value : value ? [value] : [];
        return values
          .map((item) => textFromUnknown(item).trim())
          .filter(Boolean)
          .slice(0, maxItems);
      },
      z.array(z.string().max(maxChars))
    )
    .default([]);
}

function levelEnum(value: unknown) {
  const text = textFromUnknown(value).toLowerCase();
  if (text.includes("high") || text.includes("高")) return "high";
  if (text.includes("low") || text.includes("低")) return "low";
  if (text.includes("medium") || text.includes("mid") || text.includes("中")) {
    return "medium";
  }
  return "medium";
}

function severityEnum(value: unknown) {
  const text = textFromUnknown(value).toLowerCase();
  if (text.includes("blocker") || text.includes("重大") || text.includes("不可")) {
    return "blocker";
  }
  if (text.includes("high") || text.includes("高")) return "high";
  if (text.includes("medium") || text.includes("mid") || text.includes("中")) {
    return "medium";
  }
  if (text.includes("low") || text.includes("低")) return "low";
  if (text.includes("none") || text.includes("なし")) return "none";
  return "low";
}

function trendEnum(value: unknown) {
  const text = textFromUnknown(value).toLowerCase();
  if (text.includes("rising") || text.includes("増") || text.includes("上昇")) {
    return "rising";
  }
  if (text.includes("declining") || text.includes("減") || text.includes("下降")) {
    return "declining";
  }
  return "flat";
}

function goNoGoEnum(value: unknown) {
  const text = textFromUnknown(value).toLowerCase();
  if (text.includes("no_go") || text.includes("no-go") || text.includes("見送り")) {
    return "no_go";
  }
  if (text.includes("go") || text.includes("推奨")) return "go";
  return "watch";
}

function platformEnum(value: unknown) {
  const text = textFromUnknown(value).toLowerCase();
  if (text.includes("makuake")) return "makuake";
  if (text.includes("green")) return "green_funding";
  if (text.includes("campfire")) return "campfire";
  return "other";
}

const CompetitorItemSchema = z.object({
  name: boundedText(120),
  platform: boundedText(80),
  priceJpy: z.preprocess(optionalNumber, z.number().optional()),
  url: z.string().optional(),
  reviewNote: boundedText(100).optional(),
});

const CampaignItemSchema = z.object({
  platform: z.preprocess(
    platformEnum,
    z.enum(["makuake", "green_funding", "campfire", "other"])
  ),
  title: boundedText(160),
  pledgedJpy: z.preprocess(optionalNumber, z.number().optional()),
  achievementPct: z.preprocess(optionalNumber, z.number().min(0).optional()),
  url: z.string().optional(),
});

const EvidenceItemSchema = z.object({
  claim: boundedText(180),
  sourceUrl: z.string().url(),
  snippet: boundedText(300),
});

const EvidenceArraySchema = z
  .preprocess(
    (value) => {
      const values = Array.isArray(value) ? value : value ? [value] : [];
      return values
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const sourceUrl =
            typeof record.sourceUrl === "string"
              ? record.sourceUrl
              : typeof record.url === "string"
                ? record.url
                : null;
          if (!sourceUrl) return null;
          try {
            new URL(sourceUrl);
          } catch {
            return null;
          }
          return {
            claim: record.claim ?? record.title ?? "Source evidence",
            sourceUrl,
            snippet: record.snippet ?? record.description ?? record.claim ?? sourceUrl,
          };
        })
        .filter((item): item is z.infer<typeof EvidenceItemSchema> => item !== null);
    },
    z.array(EvidenceItemSchema)
  )
  .default([]);

const JpCompetitorsSchema = z
  .preprocess(
    (value) => {
      if (Array.isArray(value)) {
        return {
          count: value.length,
          priceRangeJpy: {},
          examples: value.slice(0, 5),
        };
      }
      return value;
    },
    z.object({
      count: z.coerce.number().int().min(0).default(0),
      priceRangeJpy: z
        .object({
          min: z.preprocess(optionalNumber, z.number().optional()),
          median: z.preprocess(optionalNumber, z.number().optional()),
          max: z.preprocess(optionalNumber, z.number().optional()),
        })
        .default({}),
      examples: z.array(CompetitorItemSchema).max(5).default([]),
    })
  )
  .default({
    count: 0,
    priceRangeJpy: {},
    examples: [],
  });

const JpCFHistorySchema = z
  .preprocess(
    (value) => {
      if (Array.isArray(value)) {
        return {
          campaigns: value.slice(0, 5),
          successCount: value.filter((item) => {
            if (!item || typeof item !== "object") return false;
            const pct = optionalNumber((item as Record<string, unknown>).achievementPct);
            return typeof pct === "number" && pct >= 100;
          }).length,
          totalFound: value.length,
        };
      }
      return value;
    },
    z.object({
      campaigns: z.array(CampaignItemSchema).max(5).default([]),
      successCount: z.coerce.number().int().min(0).default(0),
      totalFound: z.coerce.number().int().min(0).default(0),
    })
  )
  .default({
    campaigns: [],
    successCount: 0,
    totalFound: 0,
  });

const RegulatoryFlagsSchema = z
  .preprocess(
    (value) => (Array.isArray(value) ? value : value ? [value] : []),
    z.array(
      z.object({
        law: boundedText(80),
        severity: z.preprocess(
          severityEnum,
          z.enum(["none", "low", "medium", "high", "blocker"])
        ),
        reason: boundedText(200),
      })
    )
  )
  .default([]);

export const JpMarketResearchSchema = z.object({
  jpCompetitors: JpCompetitorsSchema,
  jpCFHistory: JpCFHistorySchema,
  marketSignals: z
    .object({
      demandDrivers: boundedTextArray(5, 120),
      targetSegments: boundedTextArray(4, 100),
      purchaseOccasions: boundedTextArray(4, 100),
    })
    .default({
      demandDrivers: [],
      targetSegments: [],
      purchaseOccasions: [],
    }),
  positioning: z
    .object({
      makuakeAngle: boundedText(200),
      differentiation: boundedText(200),
      giftability: z
        .preprocess(levelEnum, z.enum(["low", "medium", "high"]))
        .default("medium"),
      visualStoryPotential: z
        .preprocess(levelEnum, z.enum(["low", "medium", "high"]))
        .default("medium"),
    })
    .default({
      makuakeAngle: "日本CFでの訴求角度は追加調査",
      differentiation: "差別化要素は追加調査",
      giftability: "medium",
      visualStoryPotential: "medium",
    }),
  pricing: z
    .object({
      recommendedPriceJpy: z.preprocess(optionalNumber, z.number().optional()),
      expectedMarginRisk: z
        .preprocess(levelEnum, z.enum(["low", "medium", "high"]))
        .default("medium"),
      rationale: boundedText(240),
    })
    .default({
      expectedMarginRisk: "medium",
      rationale: "価格根拠は追加調査",
    }),
  importFeasibility: z
    .object({
      certificationNeeds: boundedTextArray(6, 80),
      logisticsNotes: boundedTextArray(5, 120),
      blockerLikelihood: z
        .preprocess(levelEnum, z.enum(["low", "medium", "high"]))
        .default("medium"),
    })
    .default({
      certificationNeeds: [],
      logisticsNotes: [],
      blockerLikelihood: "medium",
    }),
  regulatoryFlags: RegulatoryFlagsSchema,
  demandTrend: z
    .preprocess(trendEnum, z.enum(["rising", "flat", "declining"]))
    .default("flat"),
  goNoGo: z.preprocess(goNoGoEnum, z.enum(["go", "watch", "no_go"])).default("watch"),
  confidence: z
    .preprocess(levelEnum, z.enum(["low", "medium", "high"]))
    .default("medium"),
  summary: boundedText(400),
  evidence: EvidenceArraySchema,
});

export type JpMarketResearch = z.infer<typeof JpMarketResearchSchema>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT = `You are a Japan import-business market researcher specializing in crowdfunding product sourcing.
For the given product, use all 8 web searches with this strategy:

**検索戦略（8回を無駄なく使う）:**
• 検索 1-2: Amazon JP・楽天・Yahoo!ショッピング — 競合品の価格帯・レビュー数・出品者数
• 検索 3-4: Makuake・CAMPFIRE・GREEN FUNDING・Kibidango — 類似キャンペーンの達成率・調達総額・支援者数
• 検索 5-6: 国内メディア・SNS需要 — GetNavi / Gizmodo Japan / ROOMIE / Lifehacker Japan / 家電 Watch / SNS言及・季節需要
• 検索 7: 規制リスク詳細 — PSE認証要否・技適・薬機法・食品衛生法の具体的適用判断
• 検索 8: 輸入障壁 — 関税分類・一般的な輸入量・既存輸入業者の有無

Return structured JSON covering these areas:

1. jpCompetitors — similar products already sold in Japan (Amazon JP, Rakuten, Yahoo Shopping, Mercari).
   Focus on price range and review sentiment (not raw counts).

2. jpCFHistory — similar campaigns on Makuake, GREEN FUNDING, CAMPFIRE, or Kibidango.
   Include pledgedJpy (JPY total raised) and achievementPct (% of goal).

3. marketSignals — why Japanese consumers would care.
   Include demandDrivers, concrete targetSegments, and purchaseOccasions.

4. positioning — how to sell this on Japanese crowdfunding.
   Include makuakeAngle, differentiation, giftability, and visualStoryPotential.
   Prefer practical positioning over generic praise.

5. pricing — recommended Japan CF price and margin risk.
   Use competitor prices, likely wholesale/import costs, and CF reward psychology.

6. importFeasibility — import blockers and operational checks.
   Include certificationNeeds (PSE, 技適, 食品衛生法, 薬機法, etc.), logisticsNotes, and blockerLikelihood.

7. regulatoryFlags — potential Japan regulatory issues.
   Laws to check: 薬機法, 景表法, PSE, 電波法/技適, 食品衛生法.
   Only include flags that genuinely apply (empty array is fine).

8. demandTrend — overall Japan consumer demand: rising / flat / declining.

9. goNoGo / confidence — go, watch, or no_go with low/medium/high confidence.
   Use no_go only for clear blockers or saturated commodity markets.

10. summary — 2–3 Japanese sentences with the most actionable insight for a CF import decision.
   Include the single biggest opportunity AND the single biggest risk.

11. evidence — EVERY claim must have a sourceUrl from your search.
   If no real URL is available for a claim, omit that claim rather than fabricating a URL.

Rules:
• Return strict JSON only. No prose, no markdown fences.
• priceRangeJpy in JPY (convert from USD/EUR at current rate if needed).
• achievementPct is a percentage where 100 = met the goal, 250 = 2.5x the goal.
• Do not overstate certainty. If search results are thin, set confidence="low" and explain the gap.
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
    marketSignals: {
      demandDrivers: ["時短・省スペース・ギフト適性（モック）"],
      targetSegments: ["ガジェット好き", "共働き世帯"],
      purchaseOccasions: ["Makuake先行購入", "ギフト"],
    },
    positioning: {
      makuakeAngle: "日常の小さな不便を解決する先行販売品として訴求（モック）",
      differentiation: "デザイン性と使い勝手の組み合わせで差別化（モック）",
      giftability: priceMedian <= 15_000 ? "high" : "medium",
      visualStoryPotential: "medium",
    },
    pricing: {
      recommendedPriceJpy: Math.round(priceMedian * 1.2),
      expectedMarginRisk: priceMedian > 30_000 ? "high" : "medium",
      rationale: "競合中央値にCF先行販売プレミアムを加味（モック）",
    },
    importFeasibility: {
      certificationNeeds: isRegulated ? ["薬機法/景表法表現確認"] : [],
      logisticsNotes: ["サイズ・重量・初回MOQをメーカー確認（モック）"],
      blockerLikelihood: isRegulated ? "medium" : "low",
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
    goNoGo: isRegulated ? "watch" : demandTrend === "declining" ? "watch" : "go",
    confidence: "medium",
    summary: `モックデータ: 類似品${competitorCount}件、需要は${demandTrend}傾向。本番は設定済みのリサーチ provider で実データを取得します。`,
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

function normalizeResearch(value: unknown): JpMarketResearch | null {
  const parsed = JpMarketResearchSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
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
    const cachedResearch = normalizeResearch(existingMeta.research.data);
    if (!cachedResearch) {
      console.warn(
        `[research] ignoring invalid cached market research for "${input.title}"`
      );
    } else {
      return {
        productId: product.id,
        runId: "cached",
        research: cachedResearch,
        cached: true,
      };
    }
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
    "Focus on Amazon Japan, Rakuten, Yahoo Shopping, Mercari, Makuake, GREEN FUNDING, CAMPFIRE, Kibidango, GetNavi, Gizmodo Japan, ROOMIE, Lifehacker Japan, and 家電 Watch.",
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
        jpCompetitorCount: outcome.data.jpCompetitors.count,
        jpCfSuccessCount: outcome.data.jpCFHistory.successCount,
        medianPriceJpy: outcome.data.jpCompetitors.priceRangeJpy.median,
        demandDrivers: outcome.data.marketSignals.demandDrivers,
        targetSegments: outcome.data.marketSignals.targetSegments,
        purchaseOccasions: outcome.data.marketSignals.purchaseOccasions,
        makuakeAngle: outcome.data.positioning.makuakeAngle,
        differentiation: outcome.data.positioning.differentiation,
        giftability: outcome.data.positioning.giftability,
        visualStoryPotential: outcome.data.positioning.visualStoryPotential,
        recommendedPriceJpy: outcome.data.pricing.recommendedPriceJpy,
        expectedMarginRisk: outcome.data.pricing.expectedMarginRisk,
        certificationNeeds: outcome.data.importFeasibility.certificationNeeds,
        logisticsNotes: outcome.data.importFeasibility.logisticsNotes,
        blockerLikelihood: outcome.data.importFeasibility.blockerLikelihood,
        goNoGo: outcome.data.goNoGo,
        confidence: outcome.data.confidence,
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
