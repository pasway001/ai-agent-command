import "./_loadenv";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { skills } from "../src/lib/db/schema";

/**
 * Seed an initial set of reusable skills covering the categories the team
 * wants on day 1: research, writing, analysis, communication.
 *
 * Idempotent — re-running upserts by slug.
 */

type SeedSkill = {
  slug: string;
  category: "research" | "writing" | "analysis" | "communication" | "other";
  name: string;
  description: string;
  promptFragment: string;
};

const seeds: SeedSkill[] = [
  // ----- research -----
  {
    slug: "jp_market_research",
    category: "research",
    name: "国内市場リサーチ",
    description: "日本国内 EC (Amazon JP / 楽天 / Yahoo) の需要・トレンド・規制を要約",
    promptFragment: `When analysing demand in the Japanese market:
- Cite the relevant marketplace (Amazon JP / 楽天 / Yahoo) when possible.
- Flag whether demand is rising / flat / declining over the past 3 months.
- Mention any 薬機法 / 景表法 sensitivities that touch this category.
- Output Japanese sentences, concise, factual.`,
  },
  {
    slug: "overseas_market_research",
    category: "research",
    name: "海外市場リサーチ",
    description: "US / 中国 / 韓国の主要EC上の競合状況・価格帯・需要を比較",
    promptFragment: `When analysing overseas markets, cover three regions when relevant:
- US (Amazon.com): BSR snapshot, price band in USD, brand-gating risk.
- China (Tmall / Taobao / JD): typical price band converted to JPY, competitor density.
- Korea (Coupang / Naver SmartStore): demand trend, dominant sellers.
For each region, finish with a one-line opportunity vs JP comparison.`,
  },
  {
    slug: "historical_comparison",
    category: "research",
    name: "過去・現在トレンド比較",
    description: "12ヶ月前と直近の価格・需要・競合数の差分を強調",
    promptFragment: `When comparing historical and current state, contrast the most recent 30 days
to the same window 12 months ago. Always report:
- price change (signed %)
- demand change (rising / flat / declining)
- competitor count change (signed integer)
- saturation risk (low / medium / high)
End with the single most actionable change (e.g. "新規参入は今でも価格優位を取りやすい").`,
  },
  {
    slug: "competitor_analysis",
    category: "research",
    name: "競合分析",
    description: "上位競合の強み・弱みを抽出し、差別化の切り口を提案",
    promptFragment: `When analysing competitors, list the top 3-5 listings and for each:
- name / brand
- price band
- 1-2 strengths visible from the listing (画像点数 / レビュー本数 / バリエーション展開)
- 1-2 weaknesses (在庫切れ / レビューでの不満点 / 説明不足)
End with 1-2 differentiation hooks our client could plausibly own.`,
  },
  {
    slug: "regulation_check_yakukiho",
    category: "analysis",
    name: "薬機法チェック",
    description: "化粧品・健康食品・医療機器表現の薬機法リスクを検出",
    promptFragment: `When evaluating copy for 薬機法 (Pharmaceutical and Medical Device Act) risk:
- Flag claims of treating / preventing disease, weight loss, anti-aging, whitening, etc.
- Distinguish 化粧品 vs 医薬部外品 vs 健康食品 vs 医療機器 categories.
- For each flagged phrase, suggest a compliant rewording.
Output: { riskLevel: "low"|"medium"|"high", findings: [...], suggestions: [...] }.`,
  },
  {
    slug: "regulation_check_keihyoho",
    category: "analysis",
    name: "景表法チェック",
    description: "優良誤認・有利誤認の可能性を検出",
    promptFragment: `When evaluating copy for 景表法 (Act against Unjustifiable Premiums and Misleading
Representations) risk:
- Flag 優良誤認 (overstated quality) and 有利誤認 (overstated price advantage).
- Pay attention to 「No.1」「最安」「業界初」 type claims and require evidence.
- Suggest evidence-anchored alternatives where possible.`,
  },
  {
    slug: "regulation_check_tokushoho",
    category: "analysis",
    name: "特商法チェック",
    description: "特定商取引法上の表記漏れ・誤解を招く返品条件を検出",
    promptFragment: `When evaluating product page copy for 特定商取引法 compliance:
- Confirm 事業者名 / 所在地 / 連絡先 / 販売価格 / 送料 / 返品条件 are present and unambiguous.
- Flag any "返品不可" phrasing that conflicts with the lawful cooling-off scope.
- For ECサイト出品では特商法に基づく表記ページの存在を前提に書く。`,
  },

  // ----- writing -----
  {
    slug: "copywriting_jp",
    category: "writing",
    name: "日本語LPコピー",
    description: "ベネフィット先行・短文・行動喚起の日本語LPコピー作法",
    promptFragment: `When producing Japanese LP copy:
- Lead with benefit, not feature.
- 1 sentence ≦ 40 chars when possible. Use line breaks generously.
- End every section with a clear next action ("今すぐ試す" / "在庫を確認する" 等).
- Avoid 薬機法 / 景表法 NG 表現. If unsure, soften ("〜と感じる方も").`,
  },
  {
    slug: "headline_writing",
    category: "writing",
    name: "広告ヘッドライン",
    description: "Meta / Google 広告向けの短い見出し+説明文作法",
    promptFragment: `When generating ad headlines:
- Provide 5 distinct angles per request (problem / outcome / social-proof / urgency / curiosity).
- Headline ≦ 30 chars JP, ≦ 30 chars EN. Description ≦ 90 chars.
- Avoid superlatives without evidence (景表法).`,
  },
  {
    slug: "faq_generation",
    category: "writing",
    name: "FAQ生成",
    description: "購入前によくある質問とその回答をペアで生成",
    promptFragment: `When generating an FAQ:
- Aim for 6-10 Q&A pairs, ordered by purchase-decision impact (size/spec → 使用感 → 返品 → 最後に企業情報).
- Each answer should be 2-3 short sentences in Japanese.
- Reflect the actual product spec; do not invent features.`,
  },

  // ----- communication -----
  {
    slug: "outreach_messaging",
    category: "communication",
    name: "仕入れ連絡文面",
    description: "国内外サプライヤ向けの最初の問い合わせメール作法",
    promptFragment: `When drafting outreach to suppliers:
- Opening: who we are (1 sentence) + which product we're enquiring about (with ASIN/SKU).
- Body: target volume, target lead time, target price band, sample needs.
- Close: clear next step + contact channel.
- Match language to recipient (JP / EN / 中文). Be polite but specific.`,
  },
  {
    slug: "cs_response",
    category: "communication",
    name: "CS応対",
    description: "問い合わせカテゴリ別のテンプレ + パーソナライズ要素",
    promptFragment: `When drafting CS responses:
- Acknowledge the customer's concern in the first sentence.
- State the action we will take, with a concrete timeframe.
- For 返品 / 返金 cases, follow the published policy verbatim — do not over-promise.
- Sign off with the customer's name and the agent's name (placeholder OK).`,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const s of seeds) {
    const existing = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.slug, s.slug))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(skills)
        .set({
          category: s.category,
          name: s.name,
          description: s.description,
          promptFragment: s.promptFragment,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing[0].id));
      console.log(`  ↻ updated ${s.slug}`);
      updated++;
    } else {
      await db.insert(skills).values({
        slug: s.slug,
        category: s.category,
        name: s.name,
        description: s.description,
        promptFragment: s.promptFragment,
      });
      console.log(`  ✔ created ${s.slug}`);
      created++;
    }
  }

  console.log(`✔ done: ${created} created, ${updated} updated`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
