import { z } from "zod";
import { findOrCreateProduct, mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";
import type { WatchlistItem } from "./scout-keepa";

export const AGENT_ID = "scout.sellersprite_research";

export const DEFAULT_SYSTEM_PROMPT = `You are a SellerSprite research agent.
Given a product candidate, return JSON: { monthlySalesJpy, competitorCount, avgRating }.
Use cautious estimates if data is incomplete.`;

const SellerspriteOutputSchema = z.object({
  monthlySalesJpy: z.number(),
  competitorCount: z.number(),
  avgRating: z.number(),
});
export type SellerspriteOutput = z.infer<typeof SellerspriteOutputSchema>;

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function mockSellersprite(item: WatchlistItem): SellerspriteOutput {
  const seed = hashStr(`ss:${item.title}`);
  const tier = seed % 10;
  const monthly =
    tier < 2
      ? 5_000_000 + ((seed >>> 4) % 4_000_000) // hot
      : tier < 5
        ? 1_500_000 + ((seed >>> 4) % 2_000_000) // healthy
        : tier < 8
          ? 400_000 + ((seed >>> 4) % 800_000) // modest
          : 100_000 + ((seed >>> 4) % 400_000); // weak

  const competitors = (seed >>> 13) % 35;
  const rating = 3.2 + (((seed >>> 17) % 18) / 10);
  return {
    monthlySalesJpy: monthly,
    competitorCount: competitors,
    avgRating: Math.round(rating * 10) / 10,
  };
}

export async function runSellerspriteForItem(item: WatchlistItem) {
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
    schema: SellerspriteOutputSchema,
    mock: () => mockSellersprite(item),
    inputPayload: { asin: item.asin },
  });

  await mergeProductMetadata(product.id, {
    signals: { sellersprite: outcome.data },
  });

  return { product, outcome };
}

export async function runSellerspriteResearch(watchlist: WatchlistItem[]) {
  const results = [];
  for (const item of watchlist) {
    results.push(await runSellerspriteForItem(item));
  }
  return results;
}
