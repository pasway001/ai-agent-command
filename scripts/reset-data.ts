import "./_loadenv";
import postgres from "postgres";
import { requireDatabaseUrl } from "../src/lib/db/url";

async function main() {
  const url = requireDatabaseUrl();

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
