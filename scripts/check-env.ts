import "./_loadenv";

type EnvKey = {
  key: string;
  requiredFor: "runtime" | "production" | "ai";
  public?: boolean;
  note?: string;
};

const keys: EnvKey[] = [
  {
    key: "NEXT_PUBLIC_SUPABASE_URL",
    requiredFor: "runtime",
    public: true,
  },
  {
    key: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    requiredFor: "runtime",
    public: true,
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    requiredFor: "runtime",
    note: "server-only",
  },
  {
    key: "DATABASE_URL",
    requiredFor: "runtime",
    note: "direct connection for migrations",
  },
  {
    key: "DATABASE_POOL_URL",
    requiredFor: "runtime",
    note: "pooled runtime connection",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    requiredFor: "production",
    public: true,
    note: "production base URL, no trailing slash",
  },
  {
    key: "LARK_WEBHOOK_URL_OPS",
    requiredFor: "production",
    note: "ops alerts; local dev can omit",
  },
  {
    key: "LARK_WEBHOOK_TIMEOUT_MS",
    requiredFor: "production",
  },
  {
    key: "BUDGET_SOFT_THRESHOLD_PCT",
    requiredFor: "production",
  },
  {
    key: "BUDGET_HARD_THRESHOLD_PCT",
    requiredFor: "production",
  },
  {
    key: "LLM_PROVIDER",
    requiredFor: "production",
    note: "keep mock until real providers are implemented",
  },
  {
    key: "ANTHROPIC_API_KEY",
    requiredFor: "ai",
  },
  {
    key: "PERPLEXITY_API_KEY",
    requiredFor: "ai",
  },
  {
    key: "APIFY_TOKEN",
    requiredFor: "ai",
  },
  {
    key: "MAKE_API_TOKEN",
    requiredFor: "ai",
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
  return /YOUR_|changeme|eyJ\.\.\.|TODO|^https:\/\/YOUR_PROJECT/i.test(value);
}

function mask(value: string | undefined): string {
  if (!value) return "missing";
  if (isPlaceholder(value)) return "placeholder";
  return "set";
}

const scoped = keys.filter((item) => order[item.requiredFor] <= order[mode]);
let missing = 0;

console.log(`env check mode=${mode}`);

for (const item of scoped) {
  const status = mask(process.env[item.key]);
  const ok = status === "set";
  if (!ok) missing += 1;
  const suffix = item.note ? ` (${item.note})` : "";
  console.log(`${ok ? "OK " : "NG "} ${item.key}: ${status}${suffix}`);
}

if (missing > 0) {
  console.error(`env check failed: ${missing} key(s) missing or placeholder`);
  process.exit(1);
}

console.log("env check passed");
