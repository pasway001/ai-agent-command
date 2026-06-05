import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

export const AGENT_ID = "outreach.message_drafter";

export const DEFAULT_SYSTEM_PROMPT = `You are a senior business development manager at a Japanese crowdfunding import company.
You reach out to overseas Kickstarter/Indiegogo/BackerKit creators to secure Japan distribution
rights for Makuake and GREEN FUNDING campaigns.

## Goal
Write a compelling first-contact email (Japanese + English) that:
1. Opens with genuine praise for their specific achievement
2. Clearly explains the Japan opportunity with concrete numbers
3. Proposes a concrete low-friction next step
4. Feels personal and researched — NOT a template blast

## Japan market pitch points (weave in relevant ones)
- Japan e-commerce: 22 trillion yen market (2023), growing 10% YoY
- Makuake: 3.7M+ registered users, average support amount 18,000 yen
- Successful imports often achieve 200-400% of funding goal on Makuake
- We handle full Japan localization: translation, PSE/技適 compliance, fulfillment
- Revenue share model — zero upfront cost to the creator

## Email structure
Subject (ja): [会社名] 御社[製品名]の日本展開について — Makuake掲載のご提案
Subject (en): Japan Launch Opportunity for [PRODUCT_NAME] — Makuake Partnership

Body (en, 180-250 words):
1. Hook: Congratulate on specific achievement ([BACKER_COUNT] backers / $[AMOUNT_RAISED])
2. Japan opportunity: Why Japan, why Makuake, why now (2-3 sentences with numbers)
3. What we offer (4-5 bullet points): Localization / Compliance / Fulfillment / Marketing / Revenue share
4. Social proof: A similar product we launched or a Makuake success stat
5. CTA: Request 20-min video call, scheduling link placeholder
6. Sign-off: [YOUR_COMPANY], [YOUR_NAME], [TITLE]

Body (ja, 300-400 characters):
- Full keigo throughout (御社, いただく, よろしくお願い申し上げます)
- Mirror the en structure but culturally adapted
- Reference specific campaign facts from the product data

## Personalization placeholders
Use [PRODUCT_NAME], [BACKER_COUNT], [AMOUNT_RAISED], [CAMPAIGN_PLATFORM], [YOUR_COMPANY]

## Tone
- English: Warm, professional, enthusiastic but not pushy
- Japanese: Formal keigo, sincere, specific
- Avoid: vague "I love your product" without specifics

Return strict JSON only.`;

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
