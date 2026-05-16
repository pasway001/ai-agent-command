import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.copy_writer";

export const DEFAULT_SYSTEM_PROMPT = `You are a Japanese e-commerce LP copywriter for Amazon JP.
Given an approved product, return JSON with keys:
- headline: catchy 18-30 chars
- subheadline: one sentence under 60 chars
- bullets: 3 bullet strings (benefit-focused)
- cta: call-to-action text under 14 chars
- problemStatement: one sentence describing the pain the product solves
- productSolution: one sentence describing how this product solves it
Keep tone confident but compliant with 薬機法/景表法.`;

const CopyOutputSchema = z.object({
  headline: z.string(),
  subheadline: z.string(),
  bullets: z.array(z.string()).length(3),
  cta: z.string(),
  problemStatement: z.string(),
  productSolution: z.string(),
});
export type CopyOutput = z.infer<typeof CopyOutputSchema>;

function mockCopy(title: string): CopyOutput {
  // Rotate base templates by hash so different products get different copy.
  const seed = title
    .split("")
    .reduce((acc, c) => (acc * 11 + c.charCodeAt(0)) >>> 0, 5);
  const ctas = ["今すぐチェック", "詳しく見る", "公式で確認", "在庫を見る"];
  const headlines = [
    `${title} で毎日が変わる`,
    `話題の${title}を試す`,
    `${title}、選ばれる理由`,
  ];
  return {
    headline: headlines[seed % headlines.length].slice(0, 30),
    subheadline: `${title} を使ってみたら、想像以上の手応えがありました。`.slice(0, 60),
    bullets: [
      "選び抜かれた品質を、毎日の習慣に。",
      "専門家の声を取り入れた設計。",
      "サポート体制が整っているので安心。",
    ],
    cta: ctas[seed % ctas.length],
    problemStatement: "毎日の小さな不満が積もって、心身の負担になっていませんか。",
    productSolution: `${title} がそれを優しく支え、ペースを取り戻す手助けになります。`,
  };
}

export async function runCopyWriter(productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new Error(`product ${productId} not found`);

  const outcome = await runAgent({
    agentId: AGENT_ID,
    productId,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    user: `Product title: ${product.title}\nASIN: ${product.asin ?? "—"}`,
    schema: CopyOutputSchema,
    mock: () => mockCopy(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, {
    lp: { copy: outcome.data },
  });

  return outcome;
}
