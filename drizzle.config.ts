import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { defineConfig } from "drizzle-kit";
import { requireDatabaseUrl } from "./src/lib/db/url";

const dbUrl = requireDatabaseUrl();

export default defineConfig({
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: dbUrl },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
