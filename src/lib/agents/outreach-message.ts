import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "outreach.message_drafter";

export const DEFAULT_SYSTEM_PROMPT = `Draft supplier outreach messages in Japanese and English.
Return JSON: { ja: { subject, body }, en: { subject, body } }
Tone: polite, concise, asks for catalog/MOQ/lead time.`;

const OutreachOutputSchema = z.object({
  ja: z.object({ subject: z.string(), body: z.string() }),
  en: z.object({ subject: z.string(), body: z.string() }),
});
export type OutreachOutput = z.infer<typeof OutreachOutputSchema>;

function mockOutreach(title: string): OutreachOutput {
  return {
    ja: {
      subject: `${title}の取扱いについて(株式会社○○)`,
      body: `突然のご連絡失礼いたします。\n御社の${title}に関心があり、お取引について検討しております。\n以下についてお伺いできますでしょうか:\n・最低発注数量(MOQ)\n・FOB価格\n・リードタイム\n・カタログのご共有可否\n\nご確認のほど、よろしくお願い申し上げます。`,
    },
    en: {
      subject: `Inquiry about ${title} — Wholesale Partnership`,
      body: `Hello,\n\nWe're interested in stocking ${title}. Could you share:\n- MOQ\n- FOB price\n- Lead time\n- Catalog\n\nThank you,\n○○ Co., Ltd.`,
    },
  };
}

export async function runOutreachDrafter(productId: string, parentRunId?: string) {
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
    schema: OutreachOutputSchema,
    mock: () => mockOutreach(product.title),
    inputPayload: { productTitle: product.title },
  });

  await mergeProductMetadata(productId, { outreach: { messages: outcome.data } });
  return outcome;
}
