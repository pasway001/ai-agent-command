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
pnpm scout:minimal     # 無料RSS → Claudeスコアリング → Inbox
pnpm scout:score       # JSON候補ファイル → Claudeスコアリング → Inbox
pnpm research:products # DBなしで公開ソースから商品候補を抽出
pnpm research:sales-pack # 抽出JSONから販売準備パックを生成
pnpm research:import     # 抽出JSONをproducts/runs/evaluations/approval_queueへ投入
pnpm sales:board         # DB内候補から利益/仕入れ確認用CSV・MDを生成
pnpm sales:outreach      # DB内候補から仕入れ打診メール/確認項目CSV・MDを生成
pnpm vercel:audit      # 任意: リンク中Vercelプロジェクトの必要env名を監査
```

## 24/7運用 (Mac mini想定)

- アプリ本体: `pm2` または `launchd` で `pnpm start` を常駐
- エージェントワーカー: 最小構成は `pnpm scout:minimal` を `cron` / `launchd` で日次実行
- DB: 最小構成はMac mini上のローカルPostgres。必要になったらSupabase等へ移行

## 既知の制約

- Hosted Postgres / Supabase pooler を使う場合に備えて `prepare: false` を設定済み
- 無料RSSクロールは取得元サイトの仕様変更で失敗する可能性あり。その場合も有料API契約は不要で、候補JSONを `pnpm scout:score <file>` に渡せます
