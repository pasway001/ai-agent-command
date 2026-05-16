import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "cs.response_drafter";

export const DEFAULT_SYSTEM_PROMPT = `Draft a customer-support response template set for a product.
Return JSON: {
  inquiry: { subject, body },     // 標準的な問い合わせ用テンプレ
  complaint: { subject, body },   // クレーム対応用
  refund: { subject, body }       // 返金/交換 案内
}
Polite, calm Japanese.`;

const CsOutputSchema = z.object({
  inquiry: z.object({ subject: z.string(), body: z.string() }),
  complaint: z.object({ subject: z.string(), body: z.string() }),
  refund: z.object({ subject: z.string(), body: z.string() }),
});
export type CsOutput = z.infer<typeof CsOutputSchema>;

function mockCs(title: string): CsOutput {
  return {
    inquiry: {
      subject: `${title}に関するお問い合わせの件`,
      body: `お問い合わせいただきありがとうございます。\n${title}に関するご質問について、以下の通りご案内いたします。\n[内容に応じて回答を追記]\nその他ご不明点がございましたら、お気軽にお知らせください。`,
    },
    complaint: {
      subject: `${title} のご不便について深くお詫び申し上げます`,
      body: `この度は${title}についてご不快な思いをおかけし、誠に申し訳ございません。\n状況を確認させていただき、迅速に対応いたします。\n恐れ入りますが、商品の状態が分かるお写真をお送りいただけますと幸いです。`,
    },
    refund: {
      subject: `${title} の返金/交換についてのご案内`,
      body: `お問い合わせの件、承知いたしました。\n${title}の返金/交換手続きを進めさせていただきます。\n配送伝票番号と購入証明をお送りください。確認次第、3営業日以内に処理いたします。`,
    },
  };
}

export async function runCsDrafter(productId: string, parentRunId?: string) {
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
    schema: CsOutputSchema,
    mock: () => mockCs(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, { cs: { templates: outcome.data } });
  return outcome;
}
