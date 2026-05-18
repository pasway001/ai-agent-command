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
| `LARK_WEBHOOK_URL_OPS` | Lark custom bot webhook | Budget alerts and daily cost summary. |
| `LARK_WEBHOOK_TIMEOUT_MS` | Local default | Recommended: `5000`. |
| `BUDGET_SOFT_THRESHOLD_PCT` | Local default | Recommended: `80`. |
| `BUDGET_HARD_THRESHOLD_PCT` | Local default | Recommended: `100`. |
| `LLM_PROVIDER` | Local default | Keep `mock` until real provider code is implemented. |

## 3. AI/Data Provider Keys

These are needed before the agents stop being deterministic mocks.

| Key | Source | Current status |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console | Required for Claude generation once implemented. |
| `OPENAI_API_KEY` | OpenAI Platform | Optional backup and image generation. |
| `PERPLEXITY_API_KEY` | Perplexity API | Required for domestic research once implemented. |
| `APIFY_TOKEN` | Apify Console | Required for real CF/data collection. |
| `MAKE_API_TOKEN` | Make.com | Required if Make becomes the main orchestrator. |
| `KEEPA_API_KEY` | Keepa | Phase 2 domestic research. |
| `SELLERSPRITE_API_KEY` | SellerSprite | Phase 2 domestic research. |

## 4. Vercel Setup

Use Vercel Project Settings -> Environment Variables.

Set `Production`, `Preview`, and `Development` deliberately. For the first production deploy, copy only the Core Runtime and Operations keys. Add AI/Data provider keys after provider implementation is merged.

Recommended first production values:

```env
NEXT_PUBLIC_APP_URL=https://<your-vercel-project>.vercel.app
LARK_WEBHOOK_TIMEOUT_MS=5000
BUDGET_SOFT_THRESHOLD_PCT=80
BUDGET_HARD_THRESHOLD_PCT=100
LLM_PROVIDER=mock
```

## 5. Local Validation

Run:

```bash
pnpm env:check
pnpm env:check:production
```

`env:check` validates the current local runtime. `env:check:production` also reports production-operation gaps such as Lark and AI provider keys.
