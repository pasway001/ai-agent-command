import "./_loadenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { agents, type NewAgent } from "../src/lib/db/schema";

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
];

async function main() {
  const url = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_POOL_URL or DATABASE_URL is not set");

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
