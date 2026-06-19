import { sql } from "drizzle-orm";
import { getDb } from "./db";
import { getAuthProvider, hasSupabaseAuthEnv, localAuthIsConfigured } from "./auth/session";
import { DB_ENV_KEYS, hasDatabaseUrl } from "./db/url";

export { DB_ENV_KEYS };

export type ReadinessCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type ReadinessReport = {
  ok: boolean;
  checks: ReadinessCheck[];
};

export const AI_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

function hasAnyEnv(keys: readonly string[]) {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

export function getRuntimeReadinessChecks(): ReadinessCheck[] {
  const authProvider = getAuthProvider();
  const authOk =
    authProvider === "supabase" ? hasSupabaseAuthEnv() : localAuthIsConfigured();

  return [
    {
      name: "database_env",
      ok: hasDatabaseUrl(),
      detail: `requires one of ${DB_ENV_KEYS.join(", ")}`,
    },
    {
      name: "auth_env",
      ok: authOk,
      detail:
        authProvider === "supabase"
          ? "supabase auth selected; requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
          : "local auth selected; requires APP_SESSION_SECRET and APP_AUTH_PASSWORD",
    },
    {
      name: "cron_secret",
      ok: Boolean(process.env.CRON_SECRET?.trim()),
      detail: "required for /api/cron/scout and /api/cron/learn",
    },
    {
      name: "ai_provider",
      ok: process.env.LLM_PROVIDER === "mock" || hasAnyEnv(AI_ENV_KEYS),
      detail:
        "LLM_PROVIDER=mock is allowed for dry runs; production research needs ANTHROPIC_API_KEY or PERPLEXITY_API_KEY",
    },
  ];
}

export async function getReadinessReport(options: { checkDb?: boolean } = {}) {
  const checks = getRuntimeReadinessChecks();

  if (options.checkDb && checks.find((c) => c.name === "database_env")?.ok) {
    try {
      await getDb().execute(sql`select 1`);
      checks.push({
        name: "database_connection",
        ok: true,
        detail: "select 1 succeeded",
      });
    } catch (err) {
      checks.push({
        name: "database_connection",
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  } satisfies ReadinessReport;
}
