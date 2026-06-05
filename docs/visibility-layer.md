# Phase A — Visibility Layer

このドキュメントは Phase A で追加された可視化レイヤーの仕様と運用手順をまとめます。
目的は **「コードを開かずに、UIだけで『何のサイトを何件叩いたか』『どれが Inbox に到達したか』『どこで失敗したか』」が分かる状態を作ること** です。

## 何が見えるようになったか

### 1. `scout_runs` テーブル (新規)

`runMinimalScout()` を呼ぶたびに 1 行 INSERT されます。
列は以下のとおりです (主要なもの):

| 列 | 意味 |
| --- | --- |
| `triggered_by` | `cron` / `manual` / `test` |
| `started_at` / `finished_at` / `duration_ms` | 実行の開始・終了・所要時間 |
| `feed_count` | 設定上のフィード数 (overseas + japan) |
| `raw_item_count` | RSS全件数 (フィルタ前) |
| `physical_count` | 物理商品判定を通った件数 |
| `dedup_dropped_count` | タイトル重複でドロップした件数 |
| `scored_count` | LLM に投げた件数 (slice 後) |
| `enqueued_count` | Inbox(approval_queue) に届いた件数 |
| `rejected_count` | LLM が `reject` 判定した件数 |
| `per_feed` (jsonb) | フィードごとの内訳。`{name, url, region, fetched, errorMessage, rawItemCount, physicalItemCount, dedupSurvivorCount}[]` |
| `errors` (jsonb) | フィード取得失敗時のメッセージ群 |

スキーマ: `src/lib/db/schema/scoutRuns.ts`
マイグレーション: `drizzle/0005_scout_runs.sql`
RLS: authenticated に read/write を付与しています。Phase B で必要なら絞り直してください。

### 2. `/scout-runs` 画面 (新規)

- **一覧**: `/scout-runs` で過去 30 回の `scout_runs` を表示します。
  列: 実行日時 (JST) / トリガー / 各カウント / 失敗フィード数 / 経過時間 / 詳細リンク。
- **詳細**: `/scout-runs/[id]` で 1 回分を詳しく見られます。
  - 上段に 6 つの統計カード (フィード数 / 生件数 / 物理通過 / 重複ドロップ / AI評価 / Inbox到着)。
  - 失敗フィードがあれば赤バナーで上部に列挙。
  - **ソース別内訳テーブル**: フィードごとに `生件数 → 物理通過 → 重複後` の絞り込み過程と URL を表示。
  - フィード URL は外部リンクとして開けます。
- サイドナビ「観測」セクションに「スカウト履歴」リンクを追加しました (`Radar` アイコン)。

### 3. `/inbox` 上部サマリーバンド (新規)

`/inbox` の最上部に「直近のスカウト」バンドが表示されます。
1 行で `日時 JST | n分前 | nソース | 生N | 物理N | 重複 -N | 評価N | Inbox N` を表示し、
失敗フィードがあれば末尾に赤字で `⚠ Yanko Design 取得失敗` のように出ます。
バンド全体をクリックすると `/scout-runs/[id]` の詳細ページに遷移します。

### 4. `/inbox` カードのソースバッジ強調

既存の「取得元」表示を、ソース名で色分けしたバッジに置き換えました。
現状の対応色 (`src/components/source-badge.tsx`):

- Kicktraq → 青系 (sky)
- Yanko Design → 橙系 (orange)
- Makuake → 緑系 (emerald)
- Campfire → 桃系 (rose)
- Kickstarter → 黄緑系 (lime)
- Indiegogo → 紫系 (violet)
- 未マッチ → ニュートラルな outline

Phase B でソースが増えた場合は `SOURCE_STYLES` に regex を追加してください。

### 5. API エンドポイント (新規)

- `GET /api/scout-runs?limit=30` — 最新の `scout_runs` を JSON で返す
- `GET /api/scout-runs/[id]` — 1 行の詳細を返す (`per_feed` 含む)

UI を介さず Slack 通知などから直接叩く用途を想定しています。
認証はアプリ全体のミドルウェアに従います (現状の `/api/*` と同じ扱い)。

## 運用ガイド

### 失敗フィードの確認方法

1. `/inbox` 上部バンドが **赤背景** だったら、その実行で取得失敗が出ています
2. バンドをクリックして `/scout-runs/[id]` へ
3. 「ソース別内訳」テーブルの「状態」列で `失敗` のフィードを特定
4. 同ページ下部の「エラーログ」セクションに具体的なエラーメッセージが残ります

恒久的に失敗するフィードを見つけたら、`SCOUT_OVERSEAS_RSS_FEEDS` などの env で
一時的に外すか、URL の更新を検討してください。

### "今朝のスカウトで何が起きたか" を 30 秒で確認する

1. `/scout-runs` を開く
2. 一番上の行 (cron, 当日朝の時刻) を見る
3. `生 → 物理 → 評価 → Inbox` の絞り込みの数列で挙動を把握
4. Inbox 列が 0 なら詳細を開いて、どのフィードで物理通過がゼロになったかを確認

## Phase B で何が更に改善されるか (予告)

Phase A はあくまで **「いま起きていることを見える化する」** までです。
Phase B では以下に踏み込みます:

- `MINIMAL_SCOUT_LIMIT` の **適用バグ修正** (現状は全フィード合算後に `.slice(0, 3)` が効いていて、せっかく取った件数を捨てている)
- **ソース拡張 9 軸化** (CES / Reddit / Product Hunt / 海外ニュース等)
- `web_search` で実際に開いた URL の永続化 (Phase A の `per_feed` と並列で `per_search` テーブル)
- 物理商品分類器の精度改善 (現状の `classifyProductText` のヒューリスティクスを LLM ベースに)
- ソースごとの長期トレンドダッシュボード (`scout_runs` の集約)

可視化レイヤー (Phase A) が入ったことで、Phase B での施策の効果が
**実行直後にダッシュボードで確認できる** ようになっています。

## ローカルでの動作確認手順

```bash
# 1. 依存関係
pnpm install

# 2. .env.local を整える (DATABASE_URL 等)
cp .env.example .env.local
# DATABASE_URL=postgres://... を埋める

# 3. マイグレーションを適用 (ローカル PG のみ。本番には適用しないでください)
pnpm db:apply-migration drizzle/0005_scout_runs.sql

# 4. スカウトを 1 回回して scout_runs に行を作る
pnpm scout:minimal

# 5. dev サーバ起動
pnpm dev

# 6. ブラウザで:
#    http://localhost:3000/inbox           上部バンドが見えるか
#    http://localhost:3000/scout-runs      履歴が並ぶか
#    http://localhost:3000/scout-runs/<id> 詳細の per_feed テーブルが見えるか
```

スモークテスト (型と shape の確認):

```bash
pnpm tsx scripts/test-scout-runs.ts
```

このスクリプトは `skipPersistence: true` で DB に書かないので、
DATABASE_URL が未設定でも実行できます。

## 本番反映時の手順

```bash
# 1. Supabase に対してマイグレーションを適用
#    drizzle/0005_scout_runs.sql の内容を Supabase SQL editor で実行するか、
#    または:
DATABASE_POOL_URL=postgres://...prod... pnpm db:apply-migration drizzle/0005_scout_runs.sql

# 2. RLS が想定通り効いているか確認
#    (本マイグレーションは authenticated に read/write を付与しています)

# 3. Vercel に再デプロイ
#    cron route が triggeredBy="cron" を渡すようになっているので、
#    デプロイ後の初回 cron 実行から scout_runs に行が積まれ始めます。
```

> **Phase A の範囲では本番マイグレーション適用も Vercel デプロイも行いません。**
> 上記は東海林さん本人が本番反映する際の手順書です。
