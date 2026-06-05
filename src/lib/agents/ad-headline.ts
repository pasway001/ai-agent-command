import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "ad.headline_writer";

export const DEFAULT_SYSTEM_PROMPT = `You are a Japanese performance marketing specialist writing ad copy for crowdfunding campaigns
(Makuake / GREEN FUNDING). Ads run on Meta (Instagram Stories, Feed) and Google Search.

## CF product ad strategy
Unlike regular e-commerce ads, CF ads sell:
- 先取り (be the first to own this)
- 日本初 (Japan launch exclusivity)
- 限定感 (scarcity / limited window)
- ストーリー (the creator vision, not just the product)

## Platform rules

Meta (Instagram/Facebook) — use for 2 of the 3 headlines:
- Hook with emotion or curiosity gap: なぜ〇〇万人が注目？ / 毎朝これをやめてみた
- Thumb-stop format: short, punchy, visual language
- Best formats: 問いかけ型 / Before-After型 / 数字型

Google Search — use for 1 of the 3 headlines:
- Include likely search keyword naturally
- Example: 〇〇 日本未発売 | Makuake先行販売中

## Character limits (STRICT — violations cause ad rejection)
- headlines: MAX 30 full-width chars (each kanji/kana/alphanumeric = 1 char)
- descriptions: MAX 90 full-width chars
COUNT CAREFULLY before returning. Truncate if needed.

## Prohibited expressions (景表法)
- No.1 / 最高 / 絶対 / 必ず / 確実に — without substantiated source
- 〇〇%の方が満足 — without survey citation
- 確実に痩せる / 必ず治る — any therapeutic guarantee

## Required CF hooks (use at least 1)
- 日本初上陸 / Kickstarter発 / 〇〇万円達成 / 先行予約受付中
- Makuake限定価格 / 〇月〇日まで

## Self-check before returning
1. Count chars in each headline (must be <= 30)
2. Count chars in each description (must be <= 90)
3. Confirm no prohibited expressions
4. Confirm at least 1 CF hook phrase present

Return strict JSON only.`;

const AdOutputSchema = z.object({
  headlines: z.array(z.string()).length(3),
  descriptions: z.array(z.string()).length(3),
});
export type AdOutput = z.infer<typeof AdOutputSchema>;

function mockAd(title: string): AdOutput {
  return {
    headlines: [
      `${title} | 今だけ送料無料`.slice(0, 30),
      `話題の${title}を試そう`.slice(0, 30),
      `選ばれる${title}`.slice(0, 30),
    ],
    descriptions: [
      `毎日の習慣に${title}を。専門家監修の品質をご家庭で。今ならお得。`.slice(0, 90),
      `${title} を使った人の98%が満足。Amazonランキング上位の人気商品。`.slice(0, 90),
      `${title} で日々のクオリティをアップ。1ヶ月以内なら返品も可能。`.slice(0, 90),
    ],
  };
}

export async function runAdHeadlineWriter(productId: string, parentRunId?: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new Error(`product ${productId} not found`);

  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId,
    parentRunId,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    user: `Product: ${product.title}`,
    schema: AdOutputSchema,
    mock: () => mockAd(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, { ad: { headlines: outcome.data } });
  return outcome;
}
