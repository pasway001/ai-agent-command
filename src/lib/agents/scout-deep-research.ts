import { z } from "zod";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";
import { SONNET_MODEL } from "../llm";
import { modelForProvider, resolveScoutResearchProvider } from "./provider";

/**
 * Deep-research agent (Stage 3.5) — runs only on products that scored >= threshold.
 *
 * Architecture:
 *   Scout scoring (Stage 3) produces a 0–1 score.
 *   Products at or above SCOUT_DEEP_RESEARCH_THRESHOLD (default 0.75) are handed
 *   to this agent for comprehensive due diligence before hitting the Inbox.
 *
 *   Model: Sonnet + 10 web searches — exhaustive, not cheap (~$0.08/product).
 *   Results cached in products.metadata.deepResearch (no TTL — re-run only when forceRefresh).
 */

export const AGENT_ID = "scout.deep_research";

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const PersonaSchema = z.object({
  description: z.string().max(200),
  purchaseMotivation: z.string().max(150),
  estimatedSpendJpy: z.number().optional(),
});

const MakuakeCampaignSchema = z.object({
  title: z.string(),
  achievementPct: z.number().min(0),
  pledgedJpy: z.number().min(0),
  backers: z.number().int().min(0).optional(),
  url: z.string().url().optional(),
});

export const DeepResearchSchema = z.object({
  targetPersonas: z.array(PersonaSchema).max(3),

  makuakePotential: z.object({
    similarCampaigns: z.array(MakuakeCampaignSchema).max(5),
    estimatedGoalJpy: z.number().optional(),
    estimatedTotalJpy: z.number().optional(),
    estimatedBackers: z.number().int().optional(),
    confidenceLevel: z.enum(["low", "medium", "high"]),
    rationale: z.string().max(400),
  }),

  pricingAnalysis: z.object({
    recommendedPriceJpy: z.number(),
    priceRationale: z.string().max(300),
    competitorPrices: z.array(
      z.object({
        platform: z.string(),
        priceJpy: z.number(),
        productName: z.string().optional(),
      })
    ).max(5),
  }),

  importRisks: z.array(
    z.object({
      risk: z.string(),
      severity: z.enum(["low", "medium", "high", "blocker"]),
      mitigation: z.string().max(200).optional(),
    })
  ).max(6),

  keyInsights: z.array(z.string().max(200)).max(5),

  executiveSummary: z.string().max(700),

  evidence: z.array(
    z.object({
      claim: z.string(),
      sourceUrl: z.string().url(),
      snippet: z.string().max(300),
    })
  ).default([]),
});

export type DeepResearch = z.infer<typeof DeepResearchSchema>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const DEEP_RESEARCH_SYSTEM_PROMPT = `You are a Japan CF import business analyst conducting deep due diligence.
A product has already passed initial screening with a high viability score.
Your job is comprehensive research to support the final go/no-go investment decision.

**検索戦略（10回をフル活用）:**
• 検索 1: 日本消費者ターゲット — 具体的な購買層、年齢・性別・ライフスタイル、購買動機
• 検索 2: Instagram JP・TikTok JP — インフルエンサー、バイラル事例、ハッシュタグ量
• 検索 3: Makuake類似キャンペーン（最も近い成功事例を1件詳細に）
• 検索 4: GREEN FUNDING・CAMPFIRE・Kibidango類似事例（Makuakeにない視点で）
• 検索 5: Amazon JP 競合上位3品 — 価格・BSR・レビュー数・出品者
• 検索 6: 楽天・Yahoo!ショッピング競合 — 追加価格データ・取扱店舗
• 検索 7: 規制精査 — PSE認証プロセス・費用・期間、技適要否、薬機法具体的制約
• 検索 8: メーカー調査 — 製造元、既存日本販売代理店の有無、OEM実績
• 検索 9: 国内商品メディア・市場規模 — GetNavi / Gizmodo Japan / ROOMIE / Lifehacker Japan / 家電 Watch とカテゴリTAM、CAGR、季節性
• 検索 10: 最新ニュース・リスク — 安全リコール、競合品の新規参入、ネガティブ報道

**Output format:**

targetPersonas: 具体的な購買者像（最大3名）、購買動機、推定支出額を含む

makuakePotential:
  similarCampaigns: 実際のMakuake/CF事例を最大5件（達成率・調達総額必須）
  estimatedGoalJpy: 推奨目標金額（JPY）
  estimatedTotalJpy: 達成可能と見込む調達総額（JPY）
  estimatedBackers: 見込み支援者数
  confidenceLevel: low/medium/high（実データに基づく自信度）
  rationale: 見積もりの根拠（300字以内）

pricingAnalysis:
  recommendedPriceJpy: 推奨販売価格（JPY、競合・市場・CF特性を踏まえた最適額）
  priceRationale: 価格設定の根拠
  competitorPrices: 競合価格（最大5件、platform・priceJpy・productName）

importRisks: リスク事項（最大6件、severity: low/medium/high/blocker、mitigation含む）

keyInsights: 意思決定に最も重要な洞察（最大5項目、各200字以内の日本語）

executiveSummary: 総合判断サマリー（700字以内の日本語、最大チャンスと最大リスクを明記）

evidence: 全主張にsourceUrlを付与。実URLがない主張は省略すること。

**Rules:**
• Return strict JSON only. No prose, no markdown fences.
• All prices in JPY (convert from USD/EUR at current exchange rate).
• This is an investment decision — be rigorous, cite sources, quantify estimates.`;

// ---------------------------------------------------------------------------
// Mock (deterministic)
// ---------------------------------------------------------------------------

function mockDeepResearch(title: string, score: number): DeepResearch {
  const priceJpy = 15000 + Math.floor(score * 20000);
  return {
    targetPersonas: [
      {
        description: `ガジェット好きの30代男性（モック: ${title}）`,
        purchaseMotivation: "海外限定品を日本でいち早く入手したい",
        estimatedSpendJpy: priceJpy,
      },
    ],
    makuakePotential: {
      similarCampaigns: [
        {
          title: `${title.slice(0, 20)} 類似キャンペーン (モック)`,
          achievementPct: 320,
          pledgedJpy: 8_500_000,
          backers: 480,
        },
      ],
      estimatedGoalJpy: 1_000_000,
      estimatedTotalJpy: 3_000_000,
      estimatedBackers: 200,
      confidenceLevel: "low",
      rationale: "モックデータ。本番はSonnet + 10回Web検索で算出します。",
    },
    pricingAnalysis: {
      recommendedPriceJpy: priceJpy,
      priceRationale: "競合価格中央値 ± 15%の範囲で設定（モック）",
      competitorPrices: [
        { platform: "Amazon JP", priceJpy: priceJpy * 0.85, productName: "類似品A (モック)" },
      ],
    },
    importRisks: [
      { risk: "PSE認証取得が必要な可能性（電気製品の場合）", severity: "medium", mitigation: "製造元に認証書類を確認" },
    ],
    keyInsights: [
      "モックデータ: 本番実行時にSonnetが10回の検索で詳細分析を行います",
    ],
    executiveSummary: `モック: ${title} のディープリサーチです。スコア ${(score * 100).toFixed(0)}/100。本番ではSonnet + web_search 10回で包括的な投資判断資料を生成します。`,
    evidence: [],
  };
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

export type DeepResearchInput = {
  productId: string;
  title: string;
  score: number;
  category?: string | null;
  description?: string | null;
  researchSummary?: string | null;
};

export type DeepResearchResult = {
  productId: string;
  runId: string;
  deepResearch: DeepResearch;
};

export async function runDeepResearch(
  input: DeepResearchInput
): Promise<DeepResearchResult> {
  const queryLines = [
    `Product: ${input.title}`,
    input.category ? `Category: ${input.category}` : null,
    input.description
      ? `Description: ${input.description.slice(0, 500)}`
      : null,
    input.researchSummary
      ? `\nPreliminary research summary: ${input.researchSummary}`
      : null,
    `\nInitial scout score: ${(input.score * 100).toFixed(0)}/100 — conduct deep due diligence for a Japan CF import go/no-go decision.`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const provider = resolveScoutResearchProvider("SCOUT_DEEP_RESEARCH_PROVIDER");
  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId: input.productId,
    defaultSystemPrompt: DEEP_RESEARCH_SYSTEM_PROMPT,
    user: queryLines,
    schema: DeepResearchSchema,
    provider,
    model: modelForProvider(
      provider,
      process.env.SCOUT_DEEP_RESEARCH_MODEL ?? SONNET_MODEL,
      "SCOUT_DEEP_RESEARCH_PERPLEXITY_MODEL"
    ),
    webSearch: true,
    webSearchMaxUses: Number(
      process.env.SCOUT_DEEP_RESEARCH_WEB_SEARCH_MAX_USES ?? "10"
    ),
    mock: () => mockDeepResearch(input.title, input.score),
    forceProvider: provider !== "mock",
    inputPayload: { title: input.title, score: input.score },
  });

  await mergeProductMetadata(input.productId, {
    deepResearch: {
      runAt: new Date().toISOString(),
      score: input.score,
      data: outcome.data,
    },
  });

  return {
    productId: input.productId,
    runId: outcome.runId,
    deepResearch: outcome.data,
  };
}
