import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { defineConfig } from "drizzle-kit";

const dbUrl = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_POOL_URL or DATABASE_URL must be set");
}

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: dbUrl },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
