import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "ad.headline_writer";

export const DEFAULT_SYSTEM_PROMPT = `Generate Meta/Google ad headlines + descriptions for a product.
Return JSON: { headlines: [string], descriptions: [string] }
3 headlines (max 30 chars), 3 descriptions (max 90 chars).`;

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
