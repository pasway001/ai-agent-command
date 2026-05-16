import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.image_curator";

export const DEFAULT_SYSTEM_PROMPT = `Suggest 4 LP image concepts for an Amazon JP product.
Return JSON: { images: [{ slot, prompt, source }] } where source is "stock" or "generated".`;

const ImageOutputSchema = z.object({
  images: z
    .array(
      z.object({
        slot: z.string(),
        prompt: z.string(),
        source: z.enum(["stock", "generated"]),
      })
    )
    .length(4),
});
export type ImageOutput = z.infer<typeof ImageOutputSchema>;

function mockImages(title: string): ImageOutput {
  return {
    images: [
      { slot: "hero", prompt: `${title} を持つ笑顔の30代日本人女性、自然光、明るい部屋`, source: "generated" },
      { slot: "lifestyle", prompt: `${title} を朝の食卓で使うシーン、暖色系`, source: "generated" },
      { slot: "ingredient", prompt: `${title} の主要素材を平置きでフラットレイ撮影`, source: "stock" },
      { slot: "pack-shot", prompt: `${title} のパッケージを白背景でクローズアップ`, source: "stock" },
    ],
  };
}

export async function runImageCurator(productId: string, parentRunId?: string) {
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
    schema: ImageOutputSchema,
    mock: () => mockImages(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, { lp: { images: outcome.data.images } });
  return outcome;
}
