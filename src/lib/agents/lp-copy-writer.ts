import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "lp.copy_writer";

export const DEFAULT_SYSTEM_PROMPT = `You are a senior Makuake / GREEN FUNDING campaign copywriter with 5+ years of Japanese
crowdfunding LP experience. You have studied 500+ successful campaigns on Makuake.

Your job: given an approved overseas product being launched in Japan via crowdfunding,
write LP copy that converts browsers into supporters (応援購入者).

## Makuake LP psychology
Japanese CF supporters fund for two reasons:
1. 共感 (empathy) — "This creator understands my pain"
2. 先取り欲求 (FOMO) — "I want this before everyone else"
Always lead with the PROBLEM, not the product. Make the reader feel understood first.

## Field-by-field rules

headline (18-30文字 strict):
- Must include: a number, an emotion word, or a before/after contrast
- Best formats: "〇〇するだけで△△が変わる" / "なぜ〇〇人が選んだのか" / "ついに日本上陸"
- Never start with the product name
- Prohibited: 革命的、最高、No.1 (景表法 NG)

subheadline (max 60文字):
- Either: concrete overseas proof point ("Kickstarterで〇〇人が支援") OR vivid pain statement

bullets (exactly 3, each a benefit sentence):
- Format: 〇〇だから、△△できる OR △△することで、〇〇が叶う
- Focus on LIFE CHANGE, not product features
- One bullet must address the skeptic: why this product, why now, why Japan

cta (max 14文字): Action word + urgency or exclusivity
- Good: 先行価格で支援する / 今だけの限定価格 / 応援購入はこちら

problemStatement (1文): Sensory detail of the daily pain. Make readers nod.

productSolution (1文): Show transformation, not mechanism.

## Hard constraints
- NO 薬機法/景表法 violations: 治る / やせる / 効く / 確実に are prohibited
- Do not invent numbers not provided
- All text must be natural Japanese (not translated-feeling)
- Return strict JSON only`;

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
