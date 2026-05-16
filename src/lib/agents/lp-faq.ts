import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.faq_generator";

export const DEFAULT_SYSTEM_PROMPT = `Generate 5 customer FAQs (q + a) for an Amazon JP product LP.
Return JSON: { faqs: [{ question, answer }] }.
Cover: usage, side effects/risks, comparison vs alternatives, return policy, shipping.`;

const FaqOutputSchema = z.object({
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).min(3).max(8),
});
export type FaqOutput = z.infer<typeof FaqOutputSchema>;

function mockFaq(title: string): FaqOutput {
  return {
    faqs: [
      {
        question: `${title} の使い方を教えてください。`,
        answer: "商品同梱の取扱説明書をご覧ください。基本的にはそのままお使いいただけます。",
      },
      {
        question: "どのくらいで効果を感じますか？",
        answer: "個人差がありますが、続けてご使用いただくことをおすすめします。",
      },
      {
        question: "他のブランドとの違いは？",
        answer: "国内品質基準を満たす素材選定と、専任サポート体制が違いです。",
      },
      {
        question: "返品・交換は可能ですか？",
        answer: "未開封の場合に限り、商品到着後30日以内であれば対応いたします。",
      },
      {
        question: "発送までどのくらいかかりますか？",
        answer: "通常はご注文から1-2営業日以内に発送いたします。",
      },
    ],
  };
}

export async function runFaqGenerator(productId: string, parentRunId?: string) {
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
    schema: FaqOutputSchema,
    mock: () => mockFaq(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, { lp: { faqs: outcome.data.faqs } });
  return outcome;
}
