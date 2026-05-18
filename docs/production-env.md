# Production Environment Setup

This file is the deployment checklist for `agent-command-center`.
Do not paste real secrets into GitHub issues, chat, or committed files.

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
| `NEXT_PUBLIC_APP_URL` | Local/production URL | No trailing slash. Used in alert links. |
| `CRON_SECRET` | Secret generator | Required for Vercel Cron `/api/cron/scout`. Use 32+ random chars. |

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
| `LLM_PROVIDER` | Local default | Use `mock` for dry runs, or `anthropic` for Claude-powered agents. |

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

Do not add Perplexity, Apify, Make, Keepa, SellerSprite, Gmail, SendGrid, or Postmark keys until the corresponding implementation is enabled. They are useful later, but they are not required for the current production UI.

## 4. Minimum-Cost Setup

Recommended first production values for Mac mini / local Postgres:

```env
AUTH_PROVIDER=local
APP_AUTH_EMAIL=admin@example.com
APP_AUTH_PASSWORD=<strong-password>
APP_SESSION_SECRET=<32+ random chars>
DATABASE_URL=postgresql://pathway:pathway@localhost:5432/pathway
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

## 5. Scout Sources

The minimum scout uses free RSS feeds by default and writes promising candidates
to the in-app Inbox. Paid research APIs are intentionally not required.

| Key | Notes |
| --- | --- |
| `SCOUT_OVERSEAS_RSS_FEEDS` | Optional comma-separated `Name|URL` feeds. Defaults to Product Hunt and Yanko Design. |
| `SCOUT_JAPAN_RSS_FEEDS` | Optional comma-separated `Name|URL` feeds. Defaults to Makuake RSS. |
| `MINIMAL_SCOUT_LIMIT` | Max candidates scored per run. Recommended: `3` at first. |

## 6. Vercel Cron

`vercel.json` runs `/api/cron/scout` once per day at `30 23 * * *`
(08:30 JST). The endpoint rejects requests unless
`Authorization: Bearer <CRON_SECRET>` is present.

## 7. Local Validation

Run:

```bash
pnpm env:check
pnpm env:check:production
pnpm env:check:ai
```

`env:check` validates the current local runtime. `env:check:production` reports production-operation gaps such as Lark. `env:check:ai` adds the minimum AI key check for the first real provider.
