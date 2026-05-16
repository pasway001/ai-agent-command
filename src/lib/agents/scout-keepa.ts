import { z } from "zod";
import { findOrCreateProduct, mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "scout.keepa_monitor";

export const DEFAULT_SYSTEM_PROMPT = `You are a Keepa price/BSR/stock monitoring agent.
Given an Amazon JP ASIN, return the latest market signals as JSON:
{ bsr, priceJpy, stockEstimate, reviewCount }.
If the ASIN is unknown, return your best estimate and mark "estimated": true.`;

const KeepaOutputSchema = z.object({
  bsr: z.number(),
  priceJpy: z.number(),
  stockEstimate: z.number(),
  reviewCount: z.number(),
});
export type KeepaOutput = z.infer<typeof KeepaOutputSchema>;

export type WatchlistItem = {
  asin: string;
  title: string;
  category?: string;
};

// FNV-1a 32-bit, mixes input chars more uniformly than a simple multiply-add.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic mock keepa signals derived from the title (and a salt) so
 * the values are stable but vary across products in a useful range.
 */
function mockKeepa(item: WatchlistItem): KeepaOutput {
  const seed = hashStr(`keepa:${item.title}`);
  // BSR distribution: log-spread so some are great (<5k) and some are bad (>100k)
  const bucket = seed % 10;
  const bsr =
    bucket < 2
      ? 500 + (seed % 4000) // top tier
      : bucket < 5
        ? 5000 + ((seed >>> 4) % 25000) // mid
        : bucket < 8
          ? 30000 + ((seed >>> 8) % 70000) // common
          : 100000 + ((seed >>> 12) % 60000); // bad

  const priceBucket = (seed >>> 13) % 5;
  const priceJpy = [980, 1980, 3580, 6480, 12800][priceBucket];
  const stock = ((seed >>> 17) % 800) + 30;
  const reviews = ((seed >>> 19) % 2000) + 20;
  return {
    bsr,
    priceJpy,
    stockEstimate: stock,
    reviewCount: reviews,
  };
}

export async function runKeepaForItem(item: WatchlistItem) {
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
    schema: KeepaOutputSchema,
    mock: () => mockKeepa(item),
    inputPayload: { asin: item.asin },
  });

  await mergeProductMetadata(product.id, {
    signals: { keepa: outcome.data },
  });

  return { product, outcome };
}

export async function runKeepaMonitor(watchlist: WatchlistItem[]) {
  const results = [];
  for (const item of watchlist) {
    results.push(await runKeepaForItem(item));
  }
  return results;
}
