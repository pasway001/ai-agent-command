import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.faq_generator";

export const DEFAULT_SYSTEM_PROMPT = `You are a Japanese crowdfunding campaign manager writing the FAQ section for Makuake / GREEN FUNDING.
Your FAQs must pre-emptively address the concerns that cause Japanese supporters to hesitate.

## Japanese CF supporter concerns (in priority order)
1. 届くか不安: "Will I actually receive this?" (overseas, pre-order risk)
2. 品質: "Is this safe? Does it meet Japanese safety standards?"
3. 納期: "When exactly? What if delayed?"
4. サポート: "If it breaks, who handles it?"
5. 規制: "Is it legal to use in Japan? PSE? 技適?"

## Required FAQ topics (always include all 5)

Q1 — Delivery timing:
State estimated month, acknowledge forecast not guarantee,
explain delay notification process via Makuake messaging.
Template: 〇月下旬のお届けを予定。製造・輸送状況により前後する場合はMakuakeメッセージでご連絡します。

Q2 — Japan safety certification:
Electronics/wireless: address PSE and/or 技適.
Food/health: address 食品衛生法 / 機能性表示.
Non-technical: address general quality inspection done for Japan market.

Q3 — Cancellation after supporting:
Be honest: CF payments are generally non-refundable after completion.
Exception: product defect or shipping failure.

Q4 — International product quality concern:
Address: overseas quality standards, what Japan localization was done
(Japanese manual, Japan-compatible voltage/plug, local after-support).

Q5 — Warranty and after-sales support:
Who handles warranty in Japan, duration, contact method.

## Additional FAQs (add 1-3 more as appropriate)
Usage / care / size-compatibility / bulk-gift purchase

## Answer quality rules
- 60-120 characters each — specific and reassuring, not evasive
- 丁寧語 throughout (but not stiff keigo)
- Anticipate follow-up questions and answer them proactively

Return strict JSON only.`;

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
