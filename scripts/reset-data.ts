import "./_loadenv";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_POOL_URL or DATABASE_URL is not set");

  const sql = postgres(url, { max: 1, prepare: false });

  // Truncate transactional data; keep `agents` master.
  await sql.unsafe(`
    truncate table
      approval_queue,
      agent_evaluations,
      agent_runs,
      cost_ledger,
      products
    restart identity cascade;
  `);

  await sql.end();
  console.log("✔ Cleared transactional data (agents master kept)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
