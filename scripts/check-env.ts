import "./_loadenv";

type EnvKey = {
  key: string;
  requiredFor: "runtime" | "production" | "ai";
  optional?: boolean;
  public?: boolean;
  note?: string;
};

const keys: EnvKey[] = [
  {
    key: "AUTH_PROVIDER",
    requiredFor: "runtime",
    optional: true,
    note: "defaults to supabase when Supabase keys exist, otherwise local",
  },
  {
    key: "DATABASE_URL",
    requiredFor: "runtime",
    optional: true,
    note: "local/direct Postgres connection",
  },
  {
    key: "DATABASE_POOL_URL",
    requiredFor: "runtime",
    optional: true,
    note: "optional pooled runtime connection",
  },
  {
    key: "DATABASE_URL_DIRECT",
    requiredFor: "runtime",
    optional: true,
    note: "optional direct/runtime Postgres alias used by some Vercel projects",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    requiredFor: "runtime",
    optional: true,
    public: true,
    note: "required only when AUTH_PROVIDER=supabase",
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    requiredFor: "runtime",
    optional: true,
    public: true,
    note: "required only when AUTH_PROVIDER=supabase",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    requiredFor: "runtime",
    optional: true,
    note: "server-only",
  },
  {
    key: "APP_AUTH_EMAIL",
    requiredFor: "runtime",
    optional: true,
    note: "required only when AUTH_PROVIDER=local",
  },
  {
    key: "APP_AUTH_PASSWORD",
    requiredFor: "runtime",
    optional: true,
    note: "required only when AUTH_PROVIDER=local",
  },
  {
    key: "APP_SESSION_SECRET",
    requiredFor: "runtime",
    optional: true,
    note: "required only when AUTH_PROVIDER=local",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    requiredFor: "production",
    public: true,
    note: "production base URL, no trailing slash",
  },
  {
    key: "CRON_SECRET",
    requiredFor: "production",
    note: "protects Vercel Cron endpoints",
  },
  {
    key: "LARK_WEBHOOK_URL_OPS",
    requiredFor: "production",
    optional: true,
    note: "ops alerts; local dev can omit",
  },
  {
    key: "LARK_WEBHOOK_TIMEOUT_MS",
    requiredFor: "production",
    optional: true,
    note: "optional; defaults to 5000ms",
  },
  {
    key: "BUDGET_SOFT_THRESHOLD_PCT",
    requiredFor: "production",
    optional: true,
    note: "optional; defaults to 80",
  },
  {
    key: "BUDGET_HARD_THRESHOLD_PCT",
    requiredFor: "production",
    optional: true,
    note: "optional; defaults to 100",
  },
  {
    key: "LLM_PROVIDER",
    requiredFor: "production",
    note: "use mock for dry runs, anthropic for Claude-powered agents",
  },
  {
    key: "ANTHROPIC_API_KEY",
    requiredFor: "ai",
    optional: true,
    note: "required only when LLM_PROVIDER=anthropic",
  },
];

const mode = process.argv.includes("--production")
  ? "production"
  : process.argv.includes("--ai")
    ? "ai"
    : "runtime";

const order = { runtime: 0, production: 1, ai: 2 } as const;

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return /YOUR_|change-?me|eyJ\.\.\.|TODO|^https:\/\/YOUR_PROJECT/i.test(value);
}

function mask(value: string | undefined): string {
  if (!value) return "missing";
  if (isPlaceholder(value)) return "placeholder";
  return "set";
}

const scoped = keys.filter((item) => order[item.requiredFor] <= order[mode]);
let missing = 0;
const authProvider =
  process.env.AUTH_PROVIDER === "supabase" ||
  (!process.env.AUTH_PROVIDER &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ? "supabase"
    : "local";
const llmProvider = process.env.LLM_PROVIDER ?? "mock";

console.log(`env check mode=${mode} auth=${authProvider} llm=${llmProvider}`);

for (const item of scoped) {
  const status = mask(process.env[item.key]);
  const ok = status === "set";
  if (!ok && !item.optional) missing += 1;
  const suffix = item.note ? ` (${item.note})` : "";
  const label = ok ? "OK " : item.optional ? "WARN" : "NG ";
  console.log(`${label} ${item.key}: ${status}${suffix}`);
}

function requireConditional(key: string, reason: string) {
  const status = mask(process.env[key]);
  const ok = status === "set";
  if (!ok) missing += 1;
  console.log(`${ok ? "OK " : "NG "} ${key}: ${status} (${reason})`);
}

function requireAny(keys: string[], reason: string) {
  const ok = keys.some((key) => mask(process.env[key]) === "set");
  if (!ok) missing += 1;
  console.log(`${ok ? "OK " : "NG "} ${keys.join(" | ")}: ${ok ? "set" : "missing"} (${reason})`);
}

requireAny(
  ["DATABASE_POOL_URL", "DATABASE_URL", "DATABASE_URL_DIRECT"],
  "Postgres connection"
);

if (authProvider === "local") {
  requireConditional("APP_AUTH_PASSWORD", "AUTH_PROVIDER=local");
  requireConditional("APP_SESSION_SECRET", "AUTH_PROVIDER=local");
} else {
  requireConditional("NEXT_PUBLIC_SUPABASE_URL", "AUTH_PROVIDER=supabase");
  requireConditional("NEXT_PUBLIC_SUPABASE_ANON_KEY", "AUTH_PROVIDER=supabase");
  requireConditional("SUPABASE_SERVICE_ROLE_KEY", "AUTH_PROVIDER=supabase");
}

if (mode === "ai" && llmProvider === "anthropic") {
  requireConditional("ANTHROPIC_API_KEY", "LLM_PROVIDER=anthropic");
}

if (missing > 0) {
  console.error(`env check failed: ${missing} key(s) missing or placeholder`);
  process.exit(1);
}

console.log("env check passed");
