import "./_loadenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { agents, type NewAgent } from "../src/lib/db/schema";
import { requireDatabaseUrl } from "../src/lib/db/url";

const seedAgents: NewAgent[] = [
  // System 1: Scout
  { id: "scout.keepa_monitor",        name: "Keepa価格・ランキング監視",      systemNo: 1, agentType: "scout",    description: "Keepa APIで対象ASINの価格・BSR・在庫を定期取得", scheduleCron: "0 */2 * * *", concurrencyLimit: 2, dailyBudgetUsd: "5", monthlyBudgetUsd: "100" },
  { id: "scout.sellersprite_research",name: "SellerSprite競合調査",            systemNo: 1, agentType: "scout",    description: "SellerSpriteでキーワード・売上・競合スコアを取得", scheduleCron: "0 4 * * *",  concurrencyLimit: 1, dailyBudgetUsd: "5", monthlyBudgetUsd: "100" },
  { id: "scout.perplexity_jp_market", name: "Perplexity国内市場リサーチ",      systemNo: 1, agentType: "scout",    description: "Perplexityで国内ニーズ・トレンド・規制をリサーチ", scheduleCron: "0 5 * * *",  concurrencyLimit: 1, dailyBudgetUsd: "3", monthlyBudgetUsd: "60"  },
  { id: "scout.scoring",              name: "発掘候補スコアリング",            systemNo: 1, agentType: "scout",    description: "上記ソースを統合しスコア付けして承認待ちInboxへ",  scheduleCron: "30 5 * * *", concurrencyLimit: 1, dailyBudgetUsd: "2", monthlyBudgetUsd: "40"  },

  // System 2: LP
  { id: "lp.copy_writer",             name: "LPコピー生成",                    systemNo: 2, agentType: "lp",       description: "承認済み商品のLPコピー(キャッチ・ベネフィット・CTA)を生成", concurrencyLimit: 2, dailyBudgetUsd: "3", monthlyBudgetUsd: "60" },
  { id: "lp.image_curator",           name: "LP画像選定/プロンプト生成",       systemNo: 2, agentType: "lp",       description: "用途に合うストック画像 or 生成プロンプトを提案",       concurrencyLimit: 2, dailyBudgetUsd: "2", monthlyBudgetUsd: "40" },
  { id: "lp.faq_generator",           name: "FAQ生成",                         systemNo: 2, agentType: "lp",       description: "想定される購入前質問とその回答を生成",                  concurrencyLimit: 2, dailyBudgetUsd: "1", monthlyBudgetUsd: "20" },
  { id: "lp.compliance_check",        name: "薬機法・景表法チェック",          systemNo: 2, agentType: "lp",       description: "コピーを表現規制でチェックし違反候補を抽出",            concurrencyLimit: 1, dailyBudgetUsd: "2", monthlyBudgetUsd: "40" },

  // System 3: Ad
  { id: "ad.headline_writer",         name: "広告見出し生成",                  systemNo: 3, agentType: "ad",       description: "Meta/Google向けの見出し+説明文セットを複数案生成",     concurrencyLimit: 2, dailyBudgetUsd: "2", monthlyBudgetUsd: "40" },
  { id: "ad.audience_research",       name: "広告ターゲット調査",              systemNo: 3, agentType: "ad",       description: "推奨ターゲット属性・興味関心・除外条件を提案",          concurrencyLimit: 1, dailyBudgetUsd: "1", monthlyBudgetUsd: "20" },
  { id: "ad.budget_optimizer",        name: "予算配分最適化",                  systemNo: 3, agentType: "ad",       description: "実績データを参照してキャンペーン予算配分を提案",        scheduleCron: "0 9 * * *", concurrencyLimit: 1, dailyBudgetUsd: "1", monthlyBudgetUsd: "20" },

  // System 4: Outreach
  { id: "outreach.supplier_finder",   name: "仕入れ先候補探索",                systemNo: 4, agentType: "outreach", description: "国内外サプライヤをリサーチし候補リストを作成",          concurrencyLimit: 1, dailyBudgetUsd: "3", monthlyBudgetUsd: "60" },
  { id: "outreach.message_drafter",   name: "連絡文面ドラフト",                systemNo: 4, agentType: "outreach", description: "候補先ごとに最適化された問い合わせ文面を多言語で生成", concurrencyLimit: 2, dailyBudgetUsd: "2", monthlyBudgetUsd: "40" },
  { id: "outreach.followup_tracker",  name: "返信フォローアップ管理",          systemNo: 4, agentType: "outreach", description: "未返信案件を抽出しフォロー文面を提案",                  scheduleCron: "0 10 * * *", concurrencyLimit: 1, dailyBudgetUsd: "1", monthlyBudgetUsd: "20" },

  // System 5: CS
  { id: "cs.inquiry_classifier",      name: "問い合わせ分類",                  systemNo: 5, agentType: "cs",       description: "受信問い合わせをカテゴリ・優先度に分類",                concurrencyLimit: 4, dailyBudgetUsd: "2", monthlyBudgetUsd: "40" },
  { id: "cs.response_drafter",        name: "返信ドラフト生成",                systemNo: 5, agentType: "cs",       description: "テンプレ+商品情報を組み合わせた返信案を生成",           concurrencyLimit: 4, dailyBudgetUsd: "3", monthlyBudgetUsd: "60" },
  { id: "cs.escalation_detector",     name: "エスカレーション判定",            systemNo: 5, agentType: "cs",       description: "クレーム・要返金・法的リスク等を検知して人へエスカレ",  concurrencyLimit: 2, dailyBudgetUsd: "1", monthlyBudgetUsd: "20" },
];

async function main() {
  const url = requireDatabaseUrl();

  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client, { casing: "snake_case" });

  let upserts = 0;
  for (const agent of seedAgents) {
    await db
      .insert(agents)
      .values(agent)
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name: agent.name,
          description: agent.description,
          systemNo: agent.systemNo,
          agentType: agent.agentType,
          scheduleCron: agent.scheduleCron ?? null,
          concurrencyLimit: agent.concurrencyLimit,
          dailyBudgetUsd: agent.dailyBudgetUsd ?? null,
          monthlyBudgetUsd: agent.monthlyBudgetUsd ?? null,
          updatedAt: new Date(),
        },
      });
    upserts++;
  }

  await client.end();
  console.log(`✔ Seeded ${upserts} agents`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
