# Agent Command Center

System1〜5の複数AIエージェントを24/7運用するためのオペレーションUI。
既存パイプライン（Scout → LP → Ad → Outreach → CS）の人間レビューを集約し、承認・パイプライン状況・稼働状況・実行ログ・コストを一画面で扱えます。

## スタック

- Next.js 16 (App Router) + React 19
- TypeScript + Tailwind v4 + shadcn/ui
- Drizzle ORM (postgres-js) + Supabase Postgres
- Supabase Auth (RLS, A案=認証ユーザーは全件読み書き可)

## 初期セットアップ

### 1. `.env.local` を埋める

`.env.example` を参考に、以下を `.env.local` に書く。詳しい本番チェックリストは
[`docs/production-env.md`](docs/production-env.md) を参照。

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...        # Supabase Dashboard → Project Settings → API
DATABASE_URL=...                     # Direct connection (5432) — マイグレーション用
DATABASE_POOL_URL=...                # Session pooler (6543) — Next.js runtime用
NEXT_PUBLIC_APP_URL=http://localhost:3000
LLM_PROVIDER=mock
```

> **重要**: `DATABASE_URL` のパスワードは Supabase Dashboard → Database → "Reset database password" でローテーションした新パスワードを使うこと。

値を入れたら、秘密値を表示せずに状態だけ確認できる：

```bash
pnpm env:check
pnpm env:check:production
```

### 2. 依存インストール

```bash
pnpm install
```

### 3. DBマイグレーション + RLS + シード

```bash
pnpm db:push          # スキーマをSupabaseへ反映
pnpm db:apply-migration drizzle/0004_budget_alerts.sql  # System 8 budget_alerts
pnpm db:apply-rls     # RLSポリシー適用 (drizzle/policies.sql)
pnpm db:seed          # 初期エージェント17件を投入
```

### 4. 開発サーバー起動

```bash
pnpm dev
```

→ http://localhost:3000  (`/inbox` にリダイレクト)

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
pnpm dev               # 開発サーバー
pnpm build             # 本番ビルド
pnpm lint              # ESLint

pnpm db:generate       # マイグレーションSQL生成 (drizzle/0000_*.sql)
pnpm db:push           # スキーマを直接適用 (開発時に便利)
pnpm db:migrate        # 生成済みマイグレーションを順次適用 (本番向け)
pnpm db:studio         # Drizzle Studio (Web UIでテーブル閲覧)
pnpm db:apply-rls      # drizzle/policies.sql を適用
pnpm db:seed           # 初期エージェント投入 (idempotent)
```

## 24/7運用 (Mac mini想定)

- アプリ本体: `pm2` または `launchd` で `pnpm start` を常駐
- エージェントワーカー: 別プロセス。BullMQ + Redis を推奨 (本リポジトリには未含・別途構築)
- ワーカーは `SUPABASE_SERVICE_ROLE_KEY` を使ってRLSをバイパスし、書き込みを行う
- UI側は anon key + Supabase Auth セッション経由で読み書きする (RLSで保護)

## 既知の制約

- Supabase pooler を使うため `prepare: false` を設定済み (Drizzle側)
- DBパスワードがチャットに残っているため初回ローテーション必須
