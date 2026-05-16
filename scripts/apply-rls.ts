import "./_loadenv";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_POOL_URL or DATABASE_URL is not set");

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
