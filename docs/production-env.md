# Local / Production Environment Setup

This file is the deployment checklist for `agent-command-center`.
Do not paste real secrets into GitHub issues, chat, or committed files.

## 0. Local One-Command Bootstrap

For the current local-only operation path, start here:

```bash
pnpm install
pnpm local:bootstrap
pnpm dev
```

`pnpm local:bootstrap` creates or completes `.env.local`, starts local
Postgres when needed, creates the `pathway` role/database, applies the Drizzle
schema, seeds the minimum Scout/LP/ad/outreach/CS pipeline agents, imports the
bundled 30-product shortlist into `/inbox`, and runs `pnpm env:check`.

## 1. Core Runtime

These variables are required for the minimum-cost production UI. This mode uses
local Postgres, local one-user auth, and Claude as the only paid API.

| Key | Source | Notes |
| --- | --- | --- |
| `AUTH_PROVIDER` | Local default | Use `local` for minimum-cost mode. |
| `APP_AUTH_EMAIL` | Local secret store | Login email for the single reviewer/admin. |
| `APP_AUTH_PASSWORD` | Local secret store | Login password. Use a strong unique value. |
| `APP_SESSION_SECRET` | Local secret store | 32+ random chars for signed session cookies. |
| `DATABASE_URL` | Local Postgres | Direct/runtime connection for the Mac mini Postgres. |
| `DATABASE_POOL_URL` | Hosted Postgres/Supabase | Optional. Leave empty for local Postgres. |
| `DATABASE_URL_DIRECT` | Hosted Postgres alias | Optional alias accepted when `DATABASE_URL` is not present. |
| `NEXT_PUBLIC_APP_URL` | Local/production URL | No trailing slash. Used in alert links. |
| `CRON_SECRET` | Secret generator | Required for `/api/cron/scout` and `/api/cron/learn`. Use 32+ random chars. |

Optional Supabase mode:

| Key | Source | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard -> Project Settings -> API | Required only when `AUTH_PROVIDER=supabase`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard -> Project Settings -> API | Required only when `AUTH_PROVIDER=supabase`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Project Settings -> API | Required only for Supabase admin scripts. |

## 2. Operations

These are not strictly required to render the UI, but they are required for production operations.

| Key | Source | Notes |
| --- | --- | --- |
| `LARK_WEBHOOK_URL_OPS` | Lark custom bot webhook | Optional but recommended. Budget alerts and daily cost summary. |
| `LARK_WEBHOOK_TIMEOUT_MS` | Local default | Recommended: `5000`. |
| `BUDGET_SOFT_THRESHOLD_PCT` | Local default | Recommended: `80`. |
| `BUDGET_HARD_THRESHOLD_PCT` | Local default | Recommended: `100`. |
| `LLM_PROVIDER` | Local default | Use `mock` for full dry runs, or `anthropic` for Claude-powered agents. Scout stages can be overridden by `SCOUT_*_PROVIDER`. |

## 3. AI Provider Keys

These are needed before the agents stop being deterministic mocks. Keep the scope small at first: use Claude only, then add other providers after their code paths exist.

| Key | Source | Current status |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console | Required when `LLM_PROVIDER=anthropic`. |
| `ANTHROPIC_DEFAULT_MODEL` | Local default | Recommended: `claude-sonnet-4-6`. |
| `ANTHROPIC_MAX_TOKENS` | Local default | Recommended: `1024` to cap per-run output. |
| `ANTHROPIC_INPUT_USD_PER_1M` | Anthropic pricing | Recommended: `3` for Claude Sonnet 4.6 cost estimates. |
| `ANTHROPIC_OUTPUT_USD_PER_1M` | Anthropic pricing | Recommended: `15` for Claude Sonnet 4.6 cost estimates. |
| `ANTHROPIC_ENABLE_WEB_SEARCH` | Local default | Keep `0` for minimum-cost mode. Set `1` only after approving paid web search. |
| `ANTHROPIC_WEB_SEARCH_MAX_USES` | Local default | Recommended: `2` when web search is enabled. |
| `ANTHROPIC_WEB_SEARCH_USD_PER_1K` | Anthropic pricing | Recommended: `10` for cost estimates. |
| `OPENAI_API_KEY` | OpenAI Platform | Optional future backup and image generation. |
| `LOCAL_LLM_BASE_URL` | Ollama / LM Studio / vLLM | Optional future local model endpoint. |
| `LOCAL_LLM_MODEL` | Local model runtime | Optional future local model name, for example Qwen. |

Perplexity is enabled for the scout research stage. If `PERPLEXITY_API_KEY` is set, `scout.perplexity_jp_market` uses `sonar-pro`; otherwise it falls back to Claude web_search when Anthropic is configured, then to deterministic mock for local dry runs. Do not add Apify, Make, Keepa, SellerSprite, Gmail, SendGrid, or Postmark keys until the corresponding implementation is enabled.

## 4. Minimum-Cost Setup

Recommended first production values for Mac mini / local Postgres:

```env
AUTH_PROVIDER=local
APP_AUTH_EMAIL=admin@example.com
APP_AUTH_PASSWORD=<strong-password>
APP_SESSION_SECRET=<32+ random chars>
DATABASE_URL=postgresql://pathway:pathway@localhost:5432/pathway
# or DATABASE_URL_DIRECT=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<32+ random chars>
LARK_WEBHOOK_TIMEOUT_MS=5000
BUDGET_SOFT_THRESHOLD_PCT=80
BUDGET_HARD_THRESHOLD_PCT=100
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=1024
ANTHROPIC_INPUT_USD_PER_1M=3
ANTHROPIC_OUTPUT_USD_PER_1M=15
ANTHROPIC_ENABLE_WEB_SEARCH=0
ANTHROPIC_WEB_SEARCH_MAX_USES=2
ANTHROPIC_WEB_SEARCH_USD_PER_1K=10
```

For a zero-cost rehearsal, temporarily set `LLM_PROVIDER=mock`.

## 4.1 Vercel Deployment Setup

When deploying to a dedicated Vercel project, set environment variables in the
Vercel dashboard or with `vercel env add`. At minimum:

| Key | Required | Notes |
| --- | --- | --- |
| `AUTH_PROVIDER` | Yes | Use `local` unless Supabase Auth is configured. |
| `APP_AUTH_EMAIL` | Yes | Login email. |
| `APP_AUTH_PASSWORD` | Yes | Strong login password. |
| `APP_SESSION_SECRET` | Yes | 32+ random chars. |
| `DATABASE_URL` or `DATABASE_POOL_URL` or `DATABASE_URL_DIRECT` | Yes | Must be reachable from Vercel. A local `localhost` Postgres URL will not work in Vercel production. |
| `NEXT_PUBLIC_APP_URL` | Yes | Production URL, no trailing slash. |
| `CRON_SECRET` | Yes | Required by `/api/cron/scout` and `/api/cron/learn`. |
| `LLM_PROVIDER` | Yes | `mock` for dry runs, `anthropic` for real Claude-powered agents. |
| `ANTHROPIC_API_KEY` | When `LLM_PROVIDER=anthropic` | Required for real Claude research/scoring. |
| `PERPLEXITY_API_KEY` | Optional | Preferred by `scout.perplexity_jp_market` when present. |

The repository includes `vercel.json` with:

- `framework: nextjs`
- `installCommand: pnpm install`
- `buildCommand: pnpm build`
- daily cron for `/api/cron/scout`

Before deploying, validate locally:

```bash
pnpm env:check:production
pnpm env:check:ai
pnpm build
```

If using the CLI, link explicitly to avoid deploying to the wrong team/project:

```bash
vercel link --yes --project <project-name-or-id> --scope <team-or-user>
vercel env pull .env.production.local --environment=production
vercel build --prod
```

## 4.2 Supabase First Data Sync

If the Vercel deployment is ready but data is not visible in the app, first open:

```text
https://<your-project>.vercel.app/api/readiness?db=1
```

Interpret the DB checks:

| Check | Meaning | Fix |
| --- | --- | --- |
| `database_connection` is OK | Vercel can connect to a Postgres/Supabase database. | If data is still missing, continue to the next checks. |
| `db_core_tables` is missing tables | The Supabase database has not received the Drizzle schema. | Run `pnpm db:push` against the production `DATABASE_URL`. |
| `db_seed_data` is below target | Tables exist, but agents or 30 scored product candidates are missing. | Run seed/import commands below. |

For a first production database sync, make sure the CLI is linked to the
dedicated Vercel project, not an old local `.vercel` link:

```bash
vercel link --yes --project ai-agent-command --scope <pasway-team-or-user-scope>
vercel env pull .env.production.local --environment=production

ENV_FILE=.env.production.local pnpm db:push
ENV_FILE=.env.production.local pnpm db:seed
ENV_FILE=.env.production.local pnpm research:import -- --input reports/scout-products-2026-06-19.json
ENV_FILE=.env.production.local pnpm sales:contacts:sync
ENV_FILE=.env.production.local pnpm local:acceptance -- --no-markdown
```

If `AUTH_PROVIDER=supabase`, also run the RLS policies after schema creation:

```bash
ENV_FILE=.env.production.local pnpm db:apply-rls
```

Then create the reviewer/admin user in Supabase Dashboard -> Authentication.
If using local auth instead, set `AUTH_PROVIDER=local` plus
`APP_AUTH_EMAIL`, `APP_AUTH_PASSWORD`, and `APP_SESSION_SECRET` in Vercel.

## 5. Scout Sources

The minimum scout uses free RSS feeds by default and writes promising candidates
to the in-app Inbox. Paid research APIs are intentionally not required.

| Key | Notes |
| --- | --- |
| `SCOUT_OVERSEAS_RSS_FEEDS` | Optional comma-separated `Name|URL` feeds. Defaults to the source registry (Kicktraq physical-product categories, Yanko Design, HN Show, Product Hunt when token exists). |
| `SCOUT_JAPAN_RSS_FEEDS` | Optional comma-separated `Name|URL` feeds. Defaults to Makuake RSS. |
| `MINIMAL_SCOUT_LIMIT` | Legacy combined limit. Use only when the two newer limits below are unset. |
| `MINIMAL_SCOUT_LIMIT_PER_FEED` | Raw items fetched from each source. Recommended: `20` to start, `30` for 30-product hunts. |
| `MINIMAL_SCOUT_LLM_MAX` | Total merged candidates sent through prefilter/research/scoring. Default: `30`. |
| `SCOUT_FETCH_TIMEOUT_MS` | Per-source fetch timeout. Default: `15000`. |
| `SCOUT_PREFILTER_PROVIDER` | Optional override for prefilter. Defaults to Anthropic when configured, else mock. |
| `SCOUT_SCORING_PROVIDER` | Optional override for scoring. Defaults to Anthropic when configured, else mock. |
| `SCOUT_RESEARCH_PROVIDER` | Optional override for Japan market research. Defaults to Perplexity when configured, else Anthropic, else mock. |
| `SCOUT_DEEP_RESEARCH_PROVIDER` | Optional override for high-score deep research. Defaults to Perplexity when configured, else Anthropic, else mock. |

## 6. Scheduled Runs

The cron endpoints can be triggered locally or by any scheduler. They reject
requests unless `Authorization: Bearer <CRON_SECRET>` is present.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scout
```

## 7. Local Validation

Run:

```bash
pnpm env:check
pnpm env:check:production
pnpm env:check:ai
pnpm local:bootstrap
pnpm local:smoke:pipeline
pnpm research:products -- --limit 30
pnpm research:products -- --limit 30 --json --out reports/scout-products.json
pnpm research:sales-pack -- --input reports/scout-products.json --out reports/sales-pack.md
pnpm research:import -- --input reports/scout-products.json --dry-run
pnpm sales:board
pnpm sales:outreach
```

`env:check` validates the current local runtime. `env:check:production` reports production-operation gaps such as Lark. `env:check:ai` adds the minimum AI key check for the first real provider.
`/api/readiness?db=1` checks runtime readiness and DB connectivity after the local server is running.
`research:products` is a DB-free live-source shortlist command for quick product discovery, and `research:sales-pack` turns its JSON output into LP/ad/outreach hypotheses. `research:import` writes the JSON into `products`, `agent_runs`, `agent_evaluations`, and `approval_queue` so reviewers can process the items in `/inbox`. The DB-backed production path remains `pnpm scout:minimal`; it requires `DATABASE_URL`, `DATABASE_POOL_URL`, or `DATABASE_URL_DIRECT` and fails early when none is configured.
