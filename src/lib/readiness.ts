import { count, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { agents, approvalQueue, products } from "./db/schema";
import { getAuthProvider, hasSupabaseAuthEnv, localAuthIsConfigured } from "./auth/session";
import { DB_ENV_KEYS, hasDatabaseUrl } from "./db/url";
import { isSellableProductRecord } from "./sales/product-selection";

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
  "CLAUDE_API_KEY",
  "PERPLEXITY_API_KEY",
] as const;

const REQUIRED_DB_TABLES = [
  "products",
  "agents",
  "agent_runs",
  "agent_evaluations",
  "approval_queue",
  "scout_runs",
] as const;

const MIN_READY_AGENT_COUNT = 10;
const MIN_READY_PRODUCT_COUNT = 30;

function hasAnyEnv(keys: readonly string[]) {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function rowsFromExecuteResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (!result || typeof result !== "object") return [];
  const maybeRows = (result as { rows?: unknown }).rows;
  return Array.isArray(maybeRows) ? (maybeRows as Record<string, unknown>[]) : [];
}

function asCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasShortlistScore(metadataValue: unknown) {
  const shortlist = asRecord(asRecord(metadataValue)?.shortlist);
  const score = shortlist?.score;
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

function errorDetail(err: unknown) {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (cause instanceof Error && cause.message !== err.message) {
    return `${err.message}; cause: ${cause.message}`;
  }
  if (cause && typeof cause === "object") {
    const code = "code" in cause ? String(cause.code) : null;
    const message = "message" in cause ? String(cause.message) : null;
    return [err.message, code ? `code=${code}` : null, message ? `cause=${message}` : null]
      .filter(Boolean)
      .join("; ");
  }
  return err.message;
}

async function getMissingCoreTables() {
  const db = getDb();
  const missing: string[] = [];

  for (const tableName of REQUIRED_DB_TABLES) {
    const result = await db.execute(
      sql`select to_regclass(${`public.${tableName}`}) as "tableRegclass"`
    );
    const [row] = rowsFromExecuteResult(result);
    if (!row?.tableRegclass) missing.push(tableName);
  }

  return missing;
}

async function appendDbDataChecks(checks: ReadinessCheck[]) {
  const db = getDb();
  const missingTables = await getMissingCoreTables();

  checks.push({
    name: "db_core_tables",
    ok: missingTables.length === 0,
    detail:
      missingTables.length === 0
        ? `found ${REQUIRED_DB_TABLES.length} required tables`
        : `missing: ${missingTables.join(", ")}; run pnpm db:push against the production DATABASE_URL`,
  });

  if (missingTables.length > 0) return;

  const [agentRow] = await db.select({ value: count() }).from(agents);
  const [approvalRow] = await db
    .select({ value: count() })
    .from(approvalQueue)
    .where(isNull(approvalQueue.decision));
  const productRows = await db
    .select({
      title: products.title,
      stage: products.stage,
      status: products.status,
      metadata: products.metadata,
    })
    .from(products);

  const agentCount = asCount(agentRow?.value);
  const openApprovalCount = asCount(approvalRow?.value);
  const readyProductCount = productRows.filter(
    (product) => isSellableProductRecord(product) && hasShortlistScore(product.metadata)
  ).length;

  checks.push({
    name: "db_seed_data",
    ok:
      agentCount >= MIN_READY_AGENT_COUNT &&
      readyProductCount >= MIN_READY_PRODUCT_COUNT,
    detail: `agents=${agentCount}/${MIN_READY_AGENT_COUNT}, sellable_scored_products=${readyProductCount}/${MIN_READY_PRODUCT_COUNT}, total_products=${productRows.length}, open_approvals=${openApprovalCount}`,
  });
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
        "LLM_PROVIDER=mock is allowed for dry runs; production scout runs prefer real AI when ANTHROPIC_API_KEY, CLAUDE_API_KEY, or PERPLEXITY_API_KEY is set",
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
      await appendDbDataChecks(checks);
    } catch (err) {
      checks.push({
        name: "database_connection",
        ok: false,
        detail: errorDetail(err),
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  } satisfies ReadinessReport;
}
