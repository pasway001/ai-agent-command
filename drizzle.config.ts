import { config } from "dotenv";

const explicitEnvFile =
  process.env.ENV_FILE?.trim() || process.env.DOTENV_CONFIG_PATH?.trim();

for (const path of explicitEnvFile ? [explicitEnvFile] : [".env.local", ".env"]) {
  config({ path });
}

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
