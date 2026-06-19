import "./_loadenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { agents, type NewAgent } from "../src/lib/db/schema";
import { requireDatabaseUrl } from "../src/lib/db/url";

const seedAgents: NewAgent[] = [
  {
    id: "scout.scoring",
    name: "商品候補スコアリング",
    systemNo: 1,
    agentType: "scout",
    description:
      "海外・国内の無料ソース/手動入力シグナルを統合し、候補をスコアリングしてInboxへ送る",
    scheduleCron: "30 8 * * *",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "lp.copy_writer",
    name: "LPコピー生成",
    systemNo: 2,
    agentType: "lp",
    description: "承認済み商品のLPコピーを生成する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "lp.compliance_check",
    name: "LPコンプライアンスチェック",
    systemNo: 2,
    agentType: "lp",
    description: "LPコピーの薬機法・景表法・PSE/技適リスクを確認する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "lp.faq_generator",
    name: "FAQ生成",
    systemNo: 2,
    agentType: "lp",
    description: "購入前の不安を解消するFAQを生成する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "lp.image_curator",
    name: "LP画像案生成",
    systemNo: 2,
    agentType: "lp",
    description: "LPで使う画像構成と生成プロンプトを提案する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "ad.headline_writer",
    name: "広告見出し生成",
    systemNo: 3,
    agentType: "ad",
    description: "Meta/Google向けの広告見出しと説明文を生成する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "outreach.message_drafter",
    name: "仕入れ連絡文面ドラフト",
    systemNo: 4,
    agentType: "outreach",
    description: "海外メーカー/クリエイターへの日本展開打診文を生成する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
  {
    id: "cs.response_drafter",
    name: "CS返信ドラフト生成",
    systemNo: 5,
    agentType: "cs",
    description: "販売開始後の問い合わせ対応テンプレートを生成する",
    concurrencyLimit: 1,
    dailyBudgetUsd: "1",
    monthlyBudgetUsd: "20",
  },
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
  console.log(`Seeded ${upserts} minimal agent(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
