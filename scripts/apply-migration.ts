import "./_loadenv";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import postgres from "postgres";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: pnpm tsx scripts/apply-migration.ts <path-to.sql>");
    process.exit(1);
  }
  const path = isAbsolute(arg) ? arg : join(process.cwd(), arg);
  const sqlText = await readFile(path, "utf8");

  const url = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_POOL_URL or DATABASE_URL is not set");

  const sql = postgres(url, { max: 1, prepare: false });
  await sql.unsafe(sqlText);
  await sql.end();
  console.log(`✔ applied ${arg}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
