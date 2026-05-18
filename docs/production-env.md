# Production Environment Setup

This file is the deployment checklist for `agent-command-center`.
Do not paste real secrets into GitHub issues, chat, or committed files.

## 1. Core Runtime

These variables are required for the production UI to boot and talk to Supabase.

| Key | Source | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard -> Project Settings -> API | Public project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard -> Project Settings -> API | Public anon key used by browser/server auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Project Settings -> API | Server-only. Never expose to browser. |
| `DATABASE_URL` | Supabase Dashboard -> Database -> Connection string | Direct connection. Use for migrations. |
| `DATABASE_POOL_URL` | Supabase Dashboard -> Database -> Pooler | Runtime connection. Use session/transaction pooler shown by Supabase. |
| `NEXT_PUBLIC_APP_URL` | Vercel production URL or custom domain | No trailing slash. Used in alert links. |

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
| `ANTHROPIC_WEB_SEARCH_MAX_USES` | Local default | Recommended: `3` to cap search spend per research run. |
| `ANTHROPIC_WEB_SEARCH_USD_PER_1K` | Local default | Recommended: `10`, matching Claude web search list pricing. |
| `OPENAI_API_KEY` | OpenAI Platform | Optional future backup and image generation. |
| `LOCAL_LLM_BASE_URL` | Ollama / LM Studio / vLLM | Optional future local model endpoint. |
| `LOCAL_LLM_MODEL` | Local model runtime | Optional future local model name, for example Qwen. |

Do not add Perplexity, Apify, Make, Keepa, SellerSprite, Gmail, SendGrid, or Postmark keys until the corresponding implementation is enabled. They are useful later, but they are not required for the current production UI.

## 4. Vercel Setup

Use Vercel Project Settings -> Environment Variables.

Set `Production`, `Preview`, and `Development` deliberately. For the first production deploy, copy the Core Runtime and Operations keys first. Add the Anthropic keys when you are ready for live Claude runs.

Recommended first production values:

```env
NEXT_PUBLIC_APP_URL=https://<your-vercel-project>.vercel.app
LARK_WEBHOOK_TIMEOUT_MS=5000
BUDGET_SOFT_THRESHOLD_PCT=80
BUDGET_HARD_THRESHOLD_PCT=100
LLM_PROVIDER=mock
```

Switch to live Claude runs with:

```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-6
ANTHROPIC_MAX_TOKENS=1024
ANTHROPIC_INPUT_USD_PER_1M=3
ANTHROPIC_OUTPUT_USD_PER_1M=15
ANTHROPIC_WEB_SEARCH_MAX_USES=3
ANTHROPIC_WEB_SEARCH_USD_PER_1K=10
```

## 5. Local Validation

Run:

```bash
pnpm env:check
pnpm env:check:production
pnpm env:check:ai
```

`env:check` validates the current local runtime. `env:check:production` reports production-operation gaps such as Lark. `env:check:ai` adds the minimum AI key check for the first real provider.
