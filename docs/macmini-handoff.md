# Agent Command Center — Mac mini セットアップ引き継ぎ

このドキュメントをそのまま Claude に渡してください。

---

## あなたが今いる状況

ZIPを展開した `agent-command-center/` ディレクトリの中にいます。
**ここは Next.js + Drizzle ORM + Claude API で動くマルチエージェント管理システムです。**

ビジネス用途：海外クラウドファンディング商品（Kickstarter等）を自動発見し、日本市場（Makuake/GREEN FUNDING）向けにスコアリング・ローカライズする。

---

## スタック

- **フレームワーク**: Next.js 16 (App Router)
- **DB**: Supabase (PostgreSQL) — `.env.local` に接続先を書く
- **LLM**: Claude API (Anthropic) — `claude-sonnet-4-6` / `claude-haiku-4-5`
- **パッケージマネージャ**: pnpm
- **プロセス管理**: PM2（24h 稼働用）
- **自動起動**: launchd (`com.pathway.scout.plist`)

---

## セットアップ手順

### 1. 前提ツールのインストール確認

```bash
node --version      # 18以上必要
pnpm --version      # なければ: npm install -g pnpm
pm2 --version       # なければ: npm install -g pm2
```

### 2. 依存パッケージのインストール

```bash
pnpm install
```

### 3. .env.local を作成

```bash
cp .env.example .env.local
```

`.env.local` を開いて以下を埋める（必須項目）：

| 変数名 | 説明 |
|---|---|
| `DATABASE_URL` | Supabase の Connection String (Transaction pooler) |
| `DATABASE_POOL_URL` | Supabase の Connection String (Session pooler) — 同じでも可 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `ANTHROPIC_API_KEY` | Claude API キー |
| `LLM_PROVIDER` | `anthropic` に設定 |
| `CRON_SECRET` | 任意のランダム文字列（例: `openssl rand -hex 32` で生成） |
| `APP_AUTH_EMAIL` | ログイン用メールアドレス |
| `APP_AUTH_PASSWORD` | ログイン用パスワード |
| `APP_SESSION_SECRET` | 32文字以上のランダム文字列 |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |
| `ANTHROPIC_ENABLE_WEB_SEARCH` | `1` |
| `SCOUT_RESEARCH_WEB_SEARCH_MAX_USES` | `8` |
| `SCOUT_DEEP_RESEARCH_THRESHOLD` | `0.75` |
| `SCOUT_DEEP_RESEARCH_WEB_SEARCH_MAX_USES` | `10` |

### 4. DBマイグレーション（Supabaseにテーブルを作成）

```bash
pnpm drizzle-kit push
```

確認プロンプトが出たら `yes` で進む。

### 5. 初期データのシード

```bash
pnpm db:seed-prompts    # エージェントのプロンプトをDBに投入
pnpm db:seed-skills     # スキル定義を投入
```

### 6. ビルド

```bash
pnpm build
```

### 7. 動作確認（1回だけ手動実行）

```bash
# スカウトを1回実行してSupabaseにデータが入るか確認
npx tsx scripts/run-minimal-scout.ts
```

正常なら末尾に `done: X/Y candidate(s) sent to Inbox` と出る。

### 8. PM2 で24h稼働開始

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # 表示されたコマンドをそのまま実行（sudo が必要）
```

確認：
```bash
pm2 status
pm2 logs scout-cron --lines 20
```

### 9. launchd 自動起動（ログイン時にPM2を起動）

```bash
cp com.pathway.scout.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pathway.scout.plist
```

---

## パイプラインの仕組み（4ステージ）

```
RSSソース(14個) → Stage0: ルールフィルター（無料）
               → Stage1: Haiku プレフィルター（$0.001/件）
               → Stage2: Sonnet + web検索8回 リサーチ（$0.05/件、7日キャッシュ）
               → Stage3: Sonnet スコアリング（決定論的、$0.03/件）
               → スコア≥0.75: Stage3.5 ディープリサーチ（Sonnet + 10回検索）
               → スコア≥0.70: Inbox に承認候補として投入
```

スカウトは1日2回自動実行：06:00 と 18:00（`ecosystem.config.js` で設定）。

---

## よく使うコマンド

```bash
# スカウト手動実行
npx tsx scripts/run-minimal-scout.ts

# リサーチだけを素早くデモ確認（DB不要）
DEMO_LIMIT=2 npx tsx scripts/demo-research.ts

# 自己学習サイクルを手動実行
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/learn

# PM2 ログ確認
pm2 logs

# PM2 再起動
pm2 restart all

# DBスキーマ確認（Drizzle Studio）
pnpm db:studio
```

---

## ファイル構成（重要なものだけ）

```
src/lib/agents/
  scout-prefilter.ts      # Stage1: Haiku プレフィルター
  scout-perplexity.ts     # Stage2: Sonnet + web_search リサーチ
  scout-scoring.ts        # Stage3: Sonnet スコアリング
  scout-deep-research.ts  # Stage3.5: 高スコア商品の詳細調査
  scout-learning.ts       # 自己学習ループ（承認/却下パターン学習）
  minimal-scout.ts        # パイプライン全体のオーケストレーター
  sources/registry.ts     # 14のRSSソース定義

scripts/
  run-minimal-scout.ts    # 手動実行スクリプト
  demo-research.ts        # DB不要のデモ（API キーだけで動く）
  run-cron.sh             # PM2から呼ばれるcronシェル

ecosystem.config.js       # PM2設定（pathway-agent / scout-cron / learn-cron）
com.pathway.scout.plist   # launchd設定（Mac mini自動起動）
docs/deploy-guide.html    # 詳細なデプロイガイド（ブラウザで開く）
```

---

## 既知の注意点

- **Supabase 接続**: `DATABASE_URL` は Transaction pooler（port 6543）、マイグレーション時は Direct connection（port 5432）を使う。`drizzle-kit push` が失敗する場合は Direct connection URL を試す。
- **Web検索**: `ANTHROPIC_ENABLE_WEB_SEARCH=1` が必須。`0` だとリサーチが機能しない。
- **モックモード**: `LLM_PROVIDER=mock` にすると API コストゼロでパイプラインのテストができる（本番データは入らない）。
- **scout_runs テーブル**: `drizzle-kit push` を忘れるとスカウト実行ログがDBエラーになる（パイプライン自体は動くが記録されない）。

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `pnpm build` で `Can't resolve 'fs'` | `next.config.ts` に `serverExternalPackages: ["postgres"]` があるか確認 |
| スカウト実行で `ANTHROPIC_API_KEY is missing` | `.env.local` の `ANTHROPIC_API_KEY` を確認 |
| Inbox に何も出ない | `LLM_PROVIDER=anthropic` になっているか確認（`mock` だとInboxに入らない） |
| `drizzle-kit push` が接続エラー | Supabase の Direct connection URL（port 5432）を使う |
| PM2 が起動しない | `node --version` が18以上か確認、`pnpm build` が先に成功しているか確認 |
