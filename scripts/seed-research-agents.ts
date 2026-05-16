import "./_loadenv";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { agents, agentPrompts } from "../src/lib/db/schema";
import { createPromptVersion } from "../src/lib/agent-sdk";

/**
 * Seed 3 dynamic Scout research agents created via the same shape as /agents/new.
 * Idempotent — re-running skips agents that already exist (by id).
 *
 * Run after migration 0002 has been applied:
 *   pnpm db:apply-migration drizzle/0002_dynamic_agents.sql
 *   pnpm tsx scripts/seed-research-agents.ts
 */

type DynamicAgentSeed = {
  id: string;
  name: string;
  description: string;
  signalKey: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema: Record<string, string>;
};

const seeds: DynamicAgentSeed[] = [
  {
    id: "scout.us_market_research",
    name: "米Amazon市場リサーチ",
    description: "米Amazonでの相当品の価格・BSR・レビュー数・参入難易度を調査",
    signalKey: "usMarket",
    systemPrompt: `You are a US Amazon market research agent for sellers based in Japan.
Given a product candidate (originally surfaced from JP market), produce a JSON object
summarising the same/similar listing on Amazon.com:
- bsrUs: best-seller rank category snapshot
- priceUsd: typical price range
- reviewCount: aggregate reviews of comparable listings
- entryDifficulty: "low" | "medium" | "high" (based on competitor saturation, brand-gating, regulation)
- summary: one short Japanese sentence summarising the opportunity vs JP.
If you do not have data, return your best estimate and add "estimated": true.`,
    userPromptTemplate: `Title: {{title}}
ASIN (JP): {{asin}}
Category: {{category}}`,
    outputSchema: {
      bsrUs: "integer",
      priceUsd: "number",
      reviewCount: "integer",
      entryDifficulty: "string",
      summary: "string",
    },
  },
  {
    id: "scout.cn_kr_market_research",
    name: "中国・韓国市場リサーチ",
    description: "Tmall / Coupang 等の主要EC上の競合状況・価格帯・需要トレンドを調査",
    signalKey: "cnKrMarket",
    systemPrompt: `You are a CN/KR e-commerce market research agent.
Given a product candidate, return JSON describing demand and competition on
Tmall / Taobao / JD (China) and Coupang / Naver Smart Store (Korea):
- chinaDemand: "rising" | "flat" | "declining"
- koreaDemand: "rising" | "flat" | "declining"
- pricePositioningJpy: typical equivalent JPY price range observed overseas
- competitorCount: rough count of comparable listings
- summary: one short Japanese sentence.
Be cautious: prefer "estimated": true with a wide range over false precision.`,
    userPromptTemplate: `Title: {{title}}
Category: {{category}}`,
    outputSchema: {
      chinaDemand: "string",
      koreaDemand: "string",
      pricePositioningJpy: "number",
      competitorCount: "integer",
      summary: "string",
    },
  },
  {
    id: "scout.trend_history_compare",
    name: "過去・現在トレンド比較",
    description: "12ヶ月前と直近の価格・需要・競合数を比較し、市場の動きを要約",
    signalKey: "trendHistory",
    systemPrompt: `You are a market trend comparison agent.
Compare market conditions for the candidate product 12 months ago vs the most recent
30 days. Return JSON:
- priceChangePct: percentage change in typical JPY price (negative = cheaper now)
- demandChange: "rising" | "flat" | "declining"
- competitorCountChange: signed integer (positive = more competitors now)
- saturationRisk: "low" | "medium" | "high"
- summary: one short Japanese sentence highlighting the most actionable change.
Use Keepa-style historical signals if present in metadata; otherwise estimate
and set "estimated": true.`,
    userPromptTemplate: `Title: {{title}}
Category: {{category}}
Recent BSR (if known): {{bsr}}
Recent price JPY (if known): {{priceJpy}}`,
    outputSchema: {
      priceChangePct: "number",
      demandChange: "string",
      competitorCountChange: "integer",
      saturationRisk: "string",
      summary: "string",
    },
  },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const seed of seeds) {
    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, seed.id))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  skip ${seed.id}: already exists`);
      skipped++;
      continue;
    }

    await db.insert(agents).values({
      id: seed.id,
      name: seed.name,
      systemNo: 1,
      agentType: "scout",
      description: seed.description,
      isDynamic: true,
      userPromptTemplate: seed.userPromptTemplate,
      outputSchema: seed.outputSchema,
      signalKey: seed.signalKey,
      concurrencyLimit: 1,
      dailyBudgetUsd: "2",
      monthlyBudgetUsd: "40",
    });

    // v1 prompt — make sure we don't double-seed if a previous run inserted only the agent row.
    const promptCount = await db
      .select({ id: agentPrompts.id })
      .from(agentPrompts)
      .where(eq(agentPrompts.agentId, seed.id))
      .limit(1);
    if (promptCount.length === 0) {
      await createPromptVersion({
        agentId: seed.id,
        systemPrompt: seed.systemPrompt,
        model: "mock",
        notes: "v1: seed-research-agents",
        activate: true,
      });
    }

    console.log(`  ✔ created ${seed.id}`);
    created++;
  }

  console.log(`✔ done: ${created} created, ${skipped} skipped`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
