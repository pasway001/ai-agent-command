# Agent Command Center

System1〜5の複数AIエージェントを24/7運用するためのオペレーションUI。
既存パイプライン（Scout → LP → Ad → Outreach → CS）の人間レビューを集約し、承認・パイプライン状況・稼働状況・実行ログ・コストを一画面で扱えます。

## スタック

- Next.js 16 (App Router) + React 19
- TypeScript + Tailwind v4 + shadcn/ui
- Drizzle ORM (postgres-js) + Postgres
- 認証: 最小構成はローカル1ユーザー認証、必要に応じて Supabase Auth

## ローカル最短起動

Vercel / Supabase 契約がなくても、このMacだけでDB・認証・Scout Inboxまで動きます。
Homebrew版Postgres 16が未インストールの場合だけ先に `brew install postgresql@16` を実行してください。

```bash
pnpm install
pnpm local:bootstrap
pnpm dev
```

`pnpm local:bootstrap` は以下をまとめて実行します。

- `.env.local` を生成または不足分だけ補完
- ローカルPostgresを起動し、`pathway` role/databaseを作成
- Drizzle schemaを非対話で適用
- Scout/LP/広告/仕入れ/CSのローカル最小agentをseed
- `reports/scout-products-2026-06-19.json` の30商品を `/inbox` 承認待ちへ投入
- `pnpm env:check` でローカル実行に必要な設定を確認

起動後は http://localhost:3000 にアクセスします。ログインメールは `admin@example.com`、パスワードは `.env.local` の `APP_AUTH_PASSWORD` です。

## 手動セットアップ

bootstrapを使わずに進める場合は、`.env.example` を参考に `.env.local` を作成します。詳しいチェックリストは
[`docs/production-env.md`](docs/production-env.md) を参照してください。

```env
AUTH_PROVIDER=local
APP_AUTH_EMAIL=admin@example.com
APP_AUTH_PASSWORD=<strong-password>
APP_AUTH_USERS_JSON=[] # 任意: 共有用メンバーをJSON配列で追加
APP_SESSION_SECRET=<32+ random chars>
DATABASE_URL=postgresql://pathway:pathway@localhost:5432/pathway
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<32+ random chars>
LLM_PROVIDER=mock
```

値を入れたら、秘密値を表示せずに状態だけ確認できます。

```bash
pnpm env:check
pnpm local:db
pnpm db:seed-minimal  # Scout/LP/広告/仕入れ/CSのローカル最小agentを投入
```

Supabase Auth を使う場合だけ `pnpm db:apply-rls` を実行してください。System 2〜5 も同時運用する段階では `pnpm db:seed` で17件のエージェントを投入できます。

## Vercelへアップする前の確認

コードはVercelにそのまま接続できる状態です。専用Vercelプロジェクト側には、最低限以下の環境変数を登録してください。

```env
AUTH_PROVIDER=local
APP_AUTH_EMAIL=<login-email>
APP_AUTH_PASSWORD=<strong-password>
APP_AUTH_USERS_JSON=[] # 任意: [{"email":"member@example.com","password":"...","name":"Member","id":"uuid"}]
APP_SESSION_SECRET=<32+ random chars>
DATABASE_URL=<Vercelから接続できるPostgres URL>
NEXT_PUBLIC_APP_URL=https://<your-project>.vercel.app
CRON_SECRET=<32+ random chars>
LLM_PROVIDER=mock
```

実APIでリサーチを回す場合は `LLM_PROVIDER=anthropic` と `ANTHROPIC_API_KEY`、日本市場リサーチをPerplexityへ寄せる場合は `PERPLEXITY_API_KEY` も登録します。DBはVercelから到達できるPostgresが必要です。手元のMacだけの `localhost` DBはVercel本番からは接続できません。

アップ前のローカル確認:

```bash
pnpm env:check:production
pnpm env:check:ai
pnpm build
```

既存の `.vercel` はローカルリンク情報でGitには入りません。別の専用Vercelへ上げる場合は、そのプロジェクトで新しくリンクしてください。

### Supabaseにデータが反映されない時

本番URLの `/api/readiness?db=1` は、VercelからDBへ接続できるかだけでなく、必須テーブルと初期データも確認します。

- `database_connection` がOKで `db_core_tables` がNG: Supabaseにschemaが未反映です
- `db_core_tables` がOKで `db_seed_data` がNG: agentsや30商品データが未投入です
- Supabase画面で別プロジェクトを見ている場合もあるため、Vercelの `DATABASE_URL` が同じSupabase projectを指しているか確認してください

初回反映は、pasway側Vercelプロジェクトにlinkしたうえで実行します。

```bash
vercel link --yes --project ai-agent-command --scope <pasway-team-or-user-scope>
vercel env pull .env.production.local --environment=production

ENV_FILE=.env.production.local pnpm db:push
ENV_FILE=.env.production.local pnpm db:seed
ENV_FILE=.env.production.local pnpm research:import -- --input reports/scout-products-2026-06-19.json
ENV_FILE=.env.production.local pnpm sales:contacts:sync
```

Supabase Authを使う場合は、schema反映後に `ENV_FILE=.env.production.local pnpm db:apply-rls` を実行し、Supabase DashboardのAuthenticationでログインユーザーも作成してください。ローカル認証で進める場合は `AUTH_PROVIDER=local` をVercelに設定します。

本番VercelのenvをCLIから取得できない場合でも、Vercel上の関数に補正投入させられます。Vercel Dashboardで `CRON_SECRET` を確認して実行してください。

```bash
curl -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://<your-project>.vercel.app/api/maintenance/bootstrap
```

成功後、`/api/readiness?db=1` の `db_seed_data` が `sellable_scored_products=30/30` 以上になります。

## 最小Scout

無料RSSソースから海外の物理商品候補だけを拾い、Makuake RSS の直近タイトルと簡易比較して、スコアリングし、承認候補だけ `/inbox` に入れます。`LLM_PROVIDER=mock` のままなら外部AI APIなしでドライランできます。Claude / Perplexity のAPIキーを入れると実リサーチへ切り替わります。

```bash
pnpm scout:minimal
```

DBや本番API設定がまだ無い状態で、公開ソースから先に30件の候補だけ確認する場合:

```bash
pnpm research:products -- --limit 30
pnpm research:products -- --limit 30 --json --out reports/scout-products.json
pnpm research:sales-pack -- --input reports/scout-products.json --out reports/sales-pack.md
pnpm research:import -- --input reports/scout-products.json --dry-run
```

`pnpm scout:minimal` はDB-backed運用コマンドです。`DATABASE_URL` / `DATABASE_POOL_URL` / `DATABASE_URL_DIRECT`
が未設定の場合は、成功に見せかけず明示的に失敗します。DB設定後は `pnpm research:import`
で抽出済み候補を `/inbox` の承認待ちへ投入できます。
ローカル起動後は `/api/readiness?db=1` で、DB/Auth/Cron/AI設定とDB接続を値を漏らさず確認できます。

## 画面構成

| ルート         | 内容                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `/inbox`       | 承認待ちInbox。優先度・担当・経過時間でレビュアーが処理              |
| `/pipeline`    | 商品パイプライン (Scout/LP/Ad/Outreach/CS/Archived のカンバン表示)   |
| `/agents`      | エージェント稼働状況。24h実行数・失敗数・同時実行数                  |
| `/runs`        | 実行ログ・根拠 (直近100件、tokens/コスト含む)                        |
| `/cost`        | コストパネル (本日/今月、エージェント別)                             |

## DBスキーマ概要

| テーブル              | 役割                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `products`            | パイプラインの主役。stage/status を持つ                            |
| `agents`              | エージェント定義 (id, schedule, 予算, 同時実行数)                  |
| `agent_runs`          | 1実行 = 1行。tokens/cost/error/parent_run_id (リトライ親) を記録   |
| `agent_evaluations`   | 自動評価 or 人間レビュー。verdict + 根拠 evidence                  |
| `approval_queue`      | 承認待ちInbox。assigned_to/claimed_at で **排他制御**              |
| `cost_ledger`         | 日次コスト集計 (任意。agent_runs から導出可)                       |

## エージェント命名規則

`<system>.<role>` (例: `scout.keepa_monitor`, `lp.copy_writer`)
新エージェントは `agents` テーブルに行追加するだけで認識されます。

## 開発時のよく使うコマンド

```bash
pnpm local:bootstrap   # .env.local生成、Postgres起動、schema適用、30商品Inbox投入
pnpm local:db          # ローカルPostgres role/database作成 + schema適用
pnpm local:smoke:pipeline # 一時商品でScout承認後のLP生成を検証して削除
pnpm local:acceptance  # 30商品/レポート/販売デスク成果物の受け入れチェック + MD出力
pnpm dev               # 開発サーバー
pnpm build             # 本番ビルド
pnpm lint              # ESLint

pnpm db:generate       # マイグレーションSQL生成 (drizzle/0000_*.sql)
pnpm db:push           # スキーマを直接適用 (開発時に便利)
pnpm db:migrate        # 生成済みマイグレーションを順次適用 (本番向け)
pnpm db:studio         # Drizzle Studio (Web UIでテーブル閲覧)
pnpm db:apply-rls      # drizzle/policies.sql を適用
pnpm db:seed-minimal   # 最小Scoutのみ投入
pnpm db:seed           # System 1〜5 全エージェント投入 (idempotent)
pnpm products:dedupe   # 同タイトルで重複した商品候補を統合
pnpm products:prune-nonphysical # 無形商材を販売候補から除外
pnpm scout:minimal     # 無料RSS → Claudeスコアリング → Inbox
pnpm scout:score       # JSON候補ファイル → Claudeスコアリング → Inbox
pnpm research:products # DBなしで公開ソースから商品候補を抽出
pnpm research:sales-pack # 抽出JSONから販売準備パックを生成
pnpm research:import     # 抽出JSONをproducts/runs/evaluations/approval_queueへ投入
pnpm sales:board         # DB内候補から利益/仕入れ確認用CSV・MDを生成
pnpm sales:outreach      # DB内候補から仕入れ打診メール/確認項目CSV・MDを生成
pnpm sales:tasks         # DB内候補から今日の販売タスクCSV・MDを生成
pnpm sales:contacts      # DB内候補の一次ソースからメーカー連絡先候補CSV・MDを生成
pnpm sales:contacts:sync # 連絡先候補をproducts.metadata.contactLeadsへ同期
pnpm vercel:audit      # 任意: リンク中Vercelプロジェクトの必要env名を監査
```

ローカル起動後は `/sales` で30商品の販売デスクを確認でき、商談ステータス/連絡先/次回確認日をローカルDBに保存し、未連絡・本日対応・商談中で絞り込めます。`pnpm sales:tasks` で追客、商談確認、未連絡高スコア商品の順に日次タスクを出力できます。`pnpm sales:contacts` で一次ソースからメール、公式サイト、クラファン、SNSなどの仕入れ連絡先候補を抽出し、`pnpm sales:contacts:sync` で `/sales` に表示できます。

## 24/7運用 (Mac mini想定)

- アプリ本体: `pm2` または `launchd` で `pnpm start` を常駐
- エージェントワーカー: 最小構成は `pnpm scout:minimal` を `cron` / `launchd` で日次実行
- DB: 最小構成はMac mini上のローカルPostgres。必要になったらSupabase等へ移行

## 既知の制約

- Hosted Postgres / Supabase pooler を使う場合に備えて `prepare: false` を設定済み
- 無料RSSクロールは取得元サイトの仕様変更で失敗する可能性あり。その場合も有料API契約は不要で、候補JSONを `pnpm scout:score <file>` に渡せます
