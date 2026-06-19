import "./_loadenv";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { requireDatabaseUrl } from "../src/lib/db/url";

async function main() {
  const url = requireDatabaseUrl();

  // prepare:false lets us use the transaction pooler (port 6543) too.
  const sql = postgres(url, { max: 1, prepare: false });
  const policySql = await readFile(
    join(process.cwd(), "drizzle", "policies.sql"),
    "utf8"
  );
  await sql.unsafe(policySql);
  await sql.end();
  console.log("✔ RLS policies applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
