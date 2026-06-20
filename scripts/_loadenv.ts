import { config } from "dotenv";

const explicitEnvFile =
  process.env.ENV_FILE?.trim() || process.env.DOTENV_CONFIG_PATH?.trim();

// Load a requested env file for production maintenance commands; otherwise use
// the local Next.js convention.
for (const path of explicitEnvFile ? [explicitEnvFile] : [".env.local", ".env"]) {
  config({ path });
}
