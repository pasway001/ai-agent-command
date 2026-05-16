# UI 改善 指示書 — Agent Command Center

対象: 70点 → 100点 を目指したフロントUIの再整備指示書。
重視観点（ユーザ指定）: ① 情報設計（一覧・詳細の見やすさ） ② アクセシビリティ・レスポンシブ ③ 操作性（ボタン配置・フィードバック）

各項目は「現状 → 問題 → 修正方針 → 該当ファイル/行 → before/after コード」の順。
作業を **Phase 0 → 1 → 2 → 3 → 4** で進める。Phase 0 は実機スクショで判明した即直しタスク。Phase 4 は「感性のポリッシュ」。

---

## サマリ（Phase 一覧）

| Phase | 目的 | 主な対象 | 体感インパクト |
| --- | --- | --- | --- |
| **0** | **実機で見えた即直し**（sticky sidebar, 英語badge日本語化, 列バランス, スキル統合） | `sidebar.tsx`, `pipeline/page.tsx`, `agents/page.tsx`, `skills/*` | **特大** |
| 1 | レスポンシブと情報密度の致命傷 | `(app)/layout.tsx`, `sidebar.tsx`, 各 list ページ | 大 |
| 2 | 操作フィードバックと可読性 | `inbox-list.tsx`, `prompt-editor.tsx`, `decision-dialog.tsx`, `agents/page.tsx`, `runs/page.tsx`, `cost/page.tsx` | 大 |
| 3 | アクセシビリティ・微調整 | Dialog, Pipeline カード, ログイン, ステータス凡例 | 中 |
| **4** | **デザイン感性のポリッシュ**（色・密度・空虚感・ブランド） | tokens, badges, status, empty cells | 中〜大 |

---

# Phase 0 — 実機スクショで見えた即直し（最優先）

> 実機キャプチャで確認した、テキストベースのコードレビューでは見逃しやすい「視覚バランスの致命傷」と、追加されたスキル機能の統合観点。

## P0-1. サイドバーが本体と一緒にスクロールしてしまう（最重要）

**現状**: [src/app/(app)/layout.tsx:14-32](src/app/(app)/layout.tsx#L14-L32) の `<div className="flex flex-1 min-h-screen">` 配下で、Sidebar も main も普通の block のまま並んでいる。本体側がスクロールすると body 全体がスクロールするので Sidebar が一緒に消える。

**期待値**: Sidebar はビューポートに張り付き、本体だけがスクロールする（典型的な管理画面の挙動）。

### 修正

**[src/app/(app)/layout.tsx](src/app/(app)/layout.tsx) の全体**:

before:
```tsx
return (
  <div className="flex flex-1 min-h-screen">
    <Sidebar user={…} />
    <main className="flex-1 min-w-0 flex flex-col">{children}</main>
  </div>
);
```

after:
```tsx
return (
  <div className="flex flex-1 h-screen overflow-hidden">
    <Sidebar
      user={…}
      className="hidden lg:flex sticky top-0 h-screen"
    />
    <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
      <MobileTopBar user={…} />
      {children}
    </main>
  </div>
);
```

ポイント:
- 親を `h-screen overflow-hidden` にして body スクロールを止める。
- Sidebar に `sticky top-0 h-screen`（または親が `h-screen overflow-hidden` ならこれだけで OK）。
- main 側を `overflow-y-auto` にしてここだけスクロール。

**root layout 側 [src/app/layout.tsx:31](src/app/layout.tsx#L31)** の body も合わせて `h-full` を保証:
```tsx
<body className="h-full flex flex-col bg-background text-foreground">
```
（既存の `min-h-full flex flex-col` を `h-full flex flex-col` に変更）

### Acceptance
- [ ] エージェント稼働状況などの長い表をスクロールしてもサイドバーが画面に貼り付いたまま。
- [ ] サイドバーが画面より高くなった場合は、サイドバー単独で内部スクロール（`flex-1 min-h-0` を nav に当てる）。

---

## P0-2. パイプラインの列バランスが崩壊している

**観察した現状**:
- Scout 列だけが 23 件あり縦長、他の列は 0 件で短く、視覚的にバランスが悪い。
- カードの高さもばらつき、余白が間延びしている。
- ステータスバッジが **`pending` / `approved` の英語そのまま**（[src/lib/db/schema/enums.ts](src/lib/db/schema/enums.ts) の DB 値が直接出ている）。
- カラム間の `gap-4` だけで仕切り感が無く、6列横並びはどこを見ているか迷う。

### 修正方針

#### (a) 列の高さを揃える + 内部スクロール

[src/app/(app)/pipeline/page.tsx:32](src/app/(app)/pipeline/page.tsx#L32):

before:
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
```
after:
```tsx
<div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 auto-rows-fr">
```

[src/app/(app)/pipeline/page.tsx:36](src/app/(app)/pipeline/page.tsx#L36) の Card 高さと内部スクロール:

before:
```tsx
<Card key={key} className="flex flex-col min-h-[400px]">
```
after:
```tsx
<Card key={key} className="flex flex-col h-[calc(100vh-220px)] min-h-[400px] bg-muted/30">
  …
  <CardContent className="flex flex-col gap-2 flex-1 overflow-y-auto pr-1">
```

各列を `h-[calc(100vh-220px)]` でビューポートに合わせ、内部だけスクロール。背景を `bg-muted/30` にしてレーンらしさを出す。

#### (b) status バッジを日本語化＋色

[src/app/(app)/pipeline/page.tsx:59-61](src/app/(app)/pipeline/page.tsx#L59-L61):

before:
```tsx
<Badge variant="outline" className="text-[10px]">
  {p.status}
</Badge>
```
after:
```tsx
<StatusBadge status={p.status} />
```

新規 `src/components/status-badge.tsx`:
```tsx
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  pending:  { label: "確認待ち", tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20" },
  approved: { label: "承認済",   tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" },
  rejected: { label: "却下",     tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const def = STATUS_LABELS[status] ?? { label: status, tone: "" };
  return (
    <Badge variant="outline" className={cn("text-[10px] font-normal", def.tone, className)}>
      {def.label}
    </Badge>
  );
}
```

このコンポーネントは Inbox / Runs でも使い回す（[runs/page.tsx](src/app/(app)/runs/page.tsx) の `succeeded/running/queued/failed/cancelled` も日本語＋色付けが望ましい）。

#### (c) 空カラムの表示

[pipeline/page.tsx:42-45](src/app/(app)/pipeline/page.tsx#L42-L45) の `"商品なし"` を以下に強化:

```tsx
<div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground py-8">
  <PackageOpen className="size-6 opacity-40" />
  <p className="text-xs">商品なし</p>
</div>
```

#### (d) カード自体の質を上げる

[pipeline/page.tsx:48-64](src/app/(app)/pipeline/page.tsx#L48-L64) のカード:

```tsx
<div
  key={p.id}
  className="rounded-md border bg-background p-3 text-xs hover:border-foreground/30 hover:shadow-sm transition-all cursor-pointer"
>
  <div className="font-medium line-clamp-2 text-foreground">{p.title}</div>
  <div className="mt-2 flex items-center justify-between gap-2">
    <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
      {p.asin && <span className="font-mono truncate">{p.asin}</span>}
    </div>
    <StatusBadge status={p.status} />
  </div>
  <div className="mt-1 text-[10px] text-muted-foreground/70">
    更新 {formatDistanceToNow(p.updatedAt, { addSuffix: true, locale: ja })}
  </div>
</div>
```

#### (e) カラムヘッダーのリズムを整える

[pipeline/page.tsx:37-40](src/app/(app)/pipeline/page.tsx#L37-L40):
```tsx
<CardHeader className="flex-row items-center justify-between space-y-0 pb-3 border-b bg-background/60 backdrop-blur-sm sticky top-0 z-10">
  <CardTitle className="text-sm font-semibold">{label}</CardTitle>
  <Badge variant="secondary" className="font-mono tabular-nums">{items.length}</Badge>
</CardHeader>
```
ヘッダーを sticky にして、レーン内スクロールしてもラベルが見える。

### Acceptance
- [ ] 6列の高さがビューポート基準で揃う。
- [ ] `pending` → `確認待ち` のように日本語化＋色分け。
- [ ] 空列が「殺風景」ではなく軽くアイコン表示。
- [ ] カード hover で持ち上がり感（shadow + border）。

---

## P0-3. エージェント稼働状況の「— の海」を解消する（感性勝負）

**観察した現状**:
- 17行 × 10列のうち、品質メトリクス（一致率・人却下率・平均応答）の多くが `—` で**空白の海**になっている。
- 「有効」バッジが**真っ黒の塗りバッジ**で並ぶため、ノイズになっている（17行ぜんぶ「有効」）。
- 行ハイライトも無く、稼働中・休眠を視覚的に区別できない。
- 「100% (n=1)」のような小さな統計値は見落とされる。

### 設計の意図を直す

このページの主目的は「**今、何が動いていて、品質はどうか**」。なので:
1. **稼働中 / 休眠 を視覚的に分ける**: 24h実行 > 0 を「アクティブ」として行 background を変える、もしくはアクティブ件数のサマリを上部に出す。
2. **状態バッジは黒塗りやめてドット表記**: 17行が同じ色だと意味が無いので、緑の小ドット + 「有効」のテキスト、無効は灰のドット。
3. **`—` を控えめに**: `text-muted-foreground/40` にして「データ無し」が前景に出ないように。
4. **n=1 の信頼性を視覚化**: n<3 のセルは ⚠ アイコンを併記、または `opacity-60`。

### 修正

#### (a) 上部にサマリ KPI を 3 枚

[src/app/(app)/agents/page.tsx:56](src/app/(app)/agents/page.tsx#L56) の本文先頭に追加:

```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
  <SummaryCard label="登録エージェント" value={list.length} />
  <SummaryCard label="稼働中 (24h)" value={list.filter((a) => a.runs24h > 0).length} accent="emerald" />
  <SummaryCard label="失敗あり (24h)" value={list.filter((a) => a.failures24h > 0).length} accent={list.some((a) => a.failures24h > 0) ? "rose" : "muted"} />
  <SummaryCard label="平均一致率 (30d)" value={fmtAvgPct(list)} />
</div>
```

`SummaryCard` は新規共通コンポーネントとして切り出す（`src/components/summary-card.tsx`）。Cost ページの KPI Card も同じものに置き換えると統一感が出る。

#### (b) ステータスをドット + テキストに

新規 `src/components/status-dot.tsx`:
```tsx
export function StatusDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.15)]" : "bg-muted-foreground/40"
        )}
      />
      <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </span>
    </span>
  );
}
```

[agents/page.tsx:105-111](src/app/(app)/agents/page.tsx#L105-L111) の状態セルを:
```tsx
<TableCell>
  <StatusDot active={a.enabled} label={a.enabled ? "有効" : "無効"} />
</TableCell>
```

#### (c) 行のハイライト（24h動いたものは前景に）

```tsx
<TableRow
  key={a.id}
  className={cn(
    a.runs24h > 0 ? "" : "opacity-65",
    a.failures24h > 0 && "bg-rose-50/30 dark:bg-rose-500/[0.04]"
  )}
>
```

#### (d) 「—」を弱める + n の小ささを視覚化

[agents/page.tsx:31-42](src/app/(app)/agents/page.tsx#L31-L42) の `fmt*` 内で空表示を変更:

```tsx
const fmtPct = (v: number | null) =>
  v === null ? <span className="text-muted-foreground/40">—</span> : `${Math.round(v * 100)}%`;
```

戻り値が ReactNode になるので type を `string | React.ReactNode` に。

n=1 の小さい注釈（[line 132-136](src/app/(app)/agents/page.tsx#L132-L136)）:
```tsx
{a.reviewed30d > 0 ? (
  <span
    className={cn(
      "ml-1 text-xs",
      a.reviewed30d < 3 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
    )}
    title={a.reviewed30d < 3 ? "サンプル数が少なく信頼性が低い" : undefined}
  >
    (n={a.reviewed30d})
  </span>
) : null}
```

#### (e) System 列をやめて行頭の「色帯」にする

System ごとのバッジが行頭で 17行並ぶのは情報密度が低い。代わりに左1pxの色帯で System を識別:

```tsx
const SYSTEM_HUE: Record<number, string> = {
  1: "before:bg-sky-500",      // Scout
  2: "before:bg-violet-500",   // LP
  3: "before:bg-amber-500",    // Ad
  4: "before:bg-emerald-500",  // Outreach
  5: "before:bg-rose-500",     // CS
  6: "before:bg-slate-500",    // Review
};

<TableRow
  className={cn(
    "relative before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-r",
    SYSTEM_HUE[a.systemNo]
  )}
>
```
そして System 列は 削除し、System名はホバーツールチップ or `名称` セルの上に小ラベルで表示:
```tsx
<TableCell>
  <Link href={`/agents/${encodeURIComponent(a.id)}`} className="block hover:underline">
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
      {SYSTEM_LABELS[a.systemNo]}
    </div>
    <div className="font-medium">{a.name}</div>
    <div className="font-mono text-xs text-muted-foreground/70">{a.id}</div>
  </Link>
</TableCell>
```
これで列数が 10 → 8 に減り、視覚的にも色帯で System が一目瞭然。

### Acceptance
- [ ] 17行に黒塗りバッジが並ばない。
- [ ] 稼働中 (runs24h > 0) と休眠が一目で区別できる。
- [ ] `—` が前景でうるさくない。
- [ ] System が左の色帯でわかる。

---

## P0-4. スキル機能の統合 — 一覧・詳細・アタッチパネル

> スキル機能はサイドバーに追加されているが、エージェント詳細との接続が分離している。一覧の情報密度は良いが、アタッチパネルが詰め込みすぎ。

### P0-4-a. スキル一覧の見直し

**現状**: [src/app/(app)/skills/page.tsx:50-77](src/app/(app)/skills/page.tsx#L50-L77) のカテゴリ別 `<ul>` レイアウト。 1行に 名前/slug/説明/件数 が押し込まれていて、複数スキルがあると単調。

**修正方針**: カードグリッドにする（**カテゴリごとに小見出し → 2〜3 カラムのカード**）。各カードで promptFragment の冒頭プレビューも見せる。

[src/app/(app)/skills/page.tsx:50-77](src/app/(app)/skills/page.tsx#L50-L77) を以下に置換:
```tsx
<ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
  {items.map((s) => (
    <li key={s.id}>
      <Link
        href={`/skills/${s.id}`}
        className="group block h-full rounded-lg border bg-background p-4 hover:border-foreground/40 hover:shadow-sm transition-all"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold group-hover:underline truncate">{s.name}</h3>
          <Badge variant="secondary" className="shrink-0">
            {s.attachCount} 利用中
          </Badge>
        </div>
        <Badge variant="outline" className="font-mono text-[11px] mb-2">
          {s.slug}
        </Badge>
        {s.description ? (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {s.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground/40 italic">説明なし</p>
        )}
      </Link>
    </li>
  ))}
</ul>
```

カテゴリ見出しのスタイル ([line 41-49](src/app/(app)/skills/page.tsx#L41-L49)):
```tsx
<div className="flex items-center gap-3">
  <h2 className="text-base font-semibold">{SKILL_CATEGORY_LABELS[cat] ?? cat}</h2>
  <span className="h-px bg-border flex-1" />
  <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
</div>
```

### P0-4-b. スキル詳細の編集セクションを Tabs に

**現状**: [src/app/(app)/skills/[id]/page.tsx:48-103](src/app/(app)/skills/[id]/page.tsx#L48-L103) で「使用中のエージェント」と「編集」が縦並び。編集セクションが大きく、上部の「使用中のエージェント」を見落とす。

**修正**: 上部に "使用中サマリー" を 1行で出し、その下に Tabs（編集 / 利用箇所）。

```tsx
<div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
  <section className="flex flex-wrap gap-2 items-center">
    <Badge variant="outline" className="font-mono">{skill.slug}</Badge>
    <Badge variant="secondary">{SKILL_CATEGORY_LABELS[skill.category] ?? skill.category}</Badge>
    <span className="text-sm text-muted-foreground ml-auto">
      {usedBy?.length ?? 0} エージェントで利用中
    </span>
  </section>

  <Tabs defaultValue="edit">
    <TabsList>
      <TabsTrigger value="edit">編集</TabsTrigger>
      <TabsTrigger value="usage">利用エージェント ({usedBy?.length ?? 0})</TabsTrigger>
    </TabsList>
    <TabsContent value="edit" className="mt-6">
      <SkillForm mode="edit" initial={…} />
    </TabsContent>
    <TabsContent value="usage" className="mt-6">
      {/* 既存の usedBy リスト */}
    </TabsContent>
  </Tabs>
</div>
```

### P0-4-c. SkillAttachPanel の密度過多を解消

**現状**: [src/app/(app)/agents/[id]/skill-attach-panel.tsx:109-232](src/app/(app)/agents/[id]/skill-attach-panel.tsx#L109-L232) で 2カラムレイアウト：
- 左: アタッチ済み + 追加候補リスト
- 右: 合成プロンプトプレビュー

並び替えボタン3個（上/下/外す）が右端で混雑。`xs` サイズの ghost ボタン3個が窮屈。

**修正方針**:
1. 並び替えはドラッグ&ドロップ（[`@dnd-kit/core`](https://dndkit.com/) 導入）または「番号セレクタ」に。最小修正なら現状維持で `gap` を広げる。
2. アタッチ済みリストの hover で操作ボタンを表示（idle 時はドット）。
3. プレビューを **「右カラム固定 sticky」** に変更してアタッチ操作中も常時見える。

#### 最小修正（操作ボタンの呼吸）
[skill-attach-panel.tsx:127-172](src/app/(app)/agents/[id]/skill-attach-panel.tsx#L127-L172):

before:
```tsx
<li
  key={s.id}
  className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
>
  <span className="text-xs text-muted-foreground font-mono w-6 text-center">
    {i + 1}
  </span>
  …
</li>
```
after:
```tsx
<li
  key={s.id}
  className="group flex items-center gap-2 rounded-md border bg-background px-3 py-2 hover:border-foreground/30 transition-colors"
>
  <span className="text-xs text-muted-foreground font-mono tabular-nums w-5 text-center">
    {i + 1}
  </span>
  <Link href={`/skills/${s.id}`} className="font-medium text-sm hover:underline truncate flex-1 min-w-0">
    {s.name}
  </Link>
  <Badge variant="outline" className="font-mono text-[10px] shrink-0">
    {s.slug}
  </Badge>
  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
    <Button variant="ghost" size="icon-xs" disabled={busy || i === 0} onClick={() => onMove(s.id, -1)} aria-label="上へ"><ChevronUp /></Button>
    <Button variant="ghost" size="icon-xs" disabled={busy || i === attached.length - 1} onClick={() => onMove(s.id, 1)} aria-label="下へ"><ChevronDown /></Button>
    <Button variant="ghost" size="icon-xs" disabled={busy} onClick={() => onDetach(s.id)} aria-label="外す" className="text-destructive hover:text-destructive"><X /></Button>
  </div>
</li>
```
hover 時のみ操作ボタン群を出すことで、idle のリストがすっきりする。

#### プレビューを sticky
[skill-attach-panel.tsx:219](src/app/(app)/agents/[id]/skill-attach-panel.tsx#L219):
```tsx
<div className="rounded-md border p-4 flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
```

### P0-4-d. SkillForm の削除ボタンの位置

[src/app/(app)/skills/skill-form.tsx:179-211](src/app/(app)/skills/skill-form.tsx#L179-L211) で 削除ボタンが左下、保存ボタンが右下。**保存と削除の距離が遠い**のは正解（誤クリック防止）だが、**削除がフォーム本体の真下にあると最後にスクロールして「あれ、削除どこ？」となる**。削除は **詳細ページ右上のドロップダウンメニュー** に移すのが管理画面の作法。

新規 `<MoreActionsMenu>`:
```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="icon"><MoreHorizontal /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem className="text-destructive" onClick={onDelete}>
      <Trash2 className="size-3.5" /> このスキルを削除
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```
これを `PageHeader` の `action` に置く。`SkillForm` の左下ボタンは削除。

### Acceptance
- [ ] スキル一覧がカードグリッドで眺めやすい。
- [ ] スキル詳細が「サマリ＋Tabs」で迷わない。
- [ ] アタッチパネルの操作が hover で出るのでリストが静か。
- [ ] 削除動線が PageHeader の menu に集約。

---

## P0-5. ユーザー情報が見切れている（サイドバー底部）

**観察した現状**: スクショの Cost ページでサイドバー底部の "ユーザー" "...iewer-test@example.com" がフッター枠で見切れている。

**原因**: [sidebar.tsx:58-78](src/components/nav/sidebar.tsx#L58-L78) でユーザー情報ブロックの下に `v0.1.0 · 2026` フッターがあり、画面が低いと圧迫されて見切れる。

**修正**:
1. `nav` を `flex-1 min-h-0 overflow-y-auto` にして、ナビ部分だけがスクロール可能に。
2. ユーザー情報とフッターは flex で底に固定。

[src/components/nav/sidebar.tsx:30-83](src/components/nav/sidebar.tsx#L30-L83) の構造を以下に:
```tsx
<aside className={cn("w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground flex flex-col h-full", className)}>
  <div className="px-5 py-5 flex items-center gap-2 border-b shrink-0">…ロゴ…</div>
  <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4 flex flex-col gap-1">
    {items.map(…)}
  </nav>
  <div className="shrink-0 border-t">
    {user ? (
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="px-2 leading-tight">
          <div className="text-sm font-medium truncate">{user.name}</div>
          <div className="text-xs text-sidebar-foreground/60 truncate">{user.email}</div>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
            <LogOut className="size-4" /> ログアウト
          </Button>
        </form>
      </div>
    ) : null}
    <div className="px-5 py-2 text-xs text-sidebar-foreground/60 border-t">v0.1.0 · {new Date().getFullYear()}</div>
  </div>
</aside>
```

### Acceptance
- [ ] 短い画面でもユーザー情報が見切れない。
- [ ] ナビが多くなっても底部が浮かない。

---

## P0-6. ナビゲーションの順序とスキル位置

**現状**: [sidebar.tsx:18-24](src/components/nav/sidebar.tsx#L18-L24) のメニュー順:
1. 承認待ち Inbox
2. 商品パイプライン
3. エージェント稼働状況
4. スキル
5. 実行ログ・根拠
6. コスト

スキルはエージェントの一部なので、エージェント直下に置くか、**「設計」グループ**として区切る方が情報構造が伝わる。

### 修正
セクションヘッダー付きナビへ：

```tsx
const SECTIONS: Array<{ label?: string; items: typeof items }> = [
  {
    label: "オペレーション",
    items: [
      { href: "/inbox",    label: "承認待ち",    icon: Inbox },
      { href: "/pipeline", label: "パイプライン", icon: Kanban },
    ],
  },
  {
    label: "エージェント",
    items: [
      { href: "/agents",   label: "稼働状況", icon: Bot },
      { href: "/skills",   label: "スキル",   icon: Sparkles },
    ],
  },
  {
    label: "観測",
    items: [
      { href: "/runs",     label: "実行ログ", icon: ScrollText },
      { href: "/cost",     label: "コスト",   icon: Coins },
    ],
  },
];
```

レンダリング:
```tsx
{SECTIONS.map((sec, i) => (
  <div key={i} className="flex flex-col gap-1">
    {sec.label ? (
      <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
        {sec.label}
      </div>
    ) : null}
    {sec.items.map(/* 既存の Link */)}
  </div>
))}
```

サイドバーの label も短くした（「商品パイプライン」→「パイプライン」、「エージェント稼働状況」→「稼働状況」）。文脈はセクション見出しで伝わる。

### Acceptance
- [ ] サイドバーが3グループに分かれて構造化される。
- [ ] スキルがエージェントの隣に来る。

---

---

# Phase 1 — 致命傷の解消

## P1-1. モバイル/狭画面でレイアウトが崩れる（Sidebar 常時固定）

**現状**: [src/app/(app)/layout.tsx:15](src/app/(app)/layout.tsx#L15) で Sidebar を `w-60 shrink-0` の常時表示にしている。`md:` などのブレークポイントが無く、スマホ幅では本体が圧迫されて横スクロールが発生する。

**修正方針**:
- デスクトップ（`lg`〜）は固定サイドバー、モバイル/タブレットは Sheet（drawer）に切替。
- 既存の `src/components/ui/sheet.tsx` が使えるはずなのでそれを利用。
- ヘッダーの左端に `Menu`（lucide-react）アイコンのトグルボタンを追加し、`lg:hidden` で表示。

### 該当ファイル
- [src/app/(app)/layout.tsx](src/app/(app)/layout.tsx)
- [src/components/nav/sidebar.tsx](src/components/nav/sidebar.tsx)

### 変更内容

1. `Sidebar` から「中身（ロゴ＋nav＋user＋footer）」を `<SidebarContent />` として切り出し、デスクトップは `<aside>`、モバイルは `<Sheet>` で同じ Content を再利用する。

2. `(app)/layout.tsx` を以下のように変更（モバイル用ヘッダーを差し込む）:

**before** ([src/app/(app)/layout.tsx:14-32](src/app/(app)/layout.tsx#L14-L32)):
```tsx
return (
  <div className="flex flex-1 min-h-screen">
    <Sidebar
      user={…}
    />
    <main className="flex-1 min-w-0 flex flex-col">{children}</main>
  </div>
);
```

**after**:
```tsx
return (
  <div className="flex flex-1 min-h-screen">
    {/* デスクトップ固定 */}
    <Sidebar
      user={…}
      className="hidden lg:flex"
    />
    <main className="flex-1 min-w-0 flex flex-col">
      {/* モバイル用ヘッダー（ハンバーガー） */}
      <MobileTopBar user={…} />
      {children}
    </main>
  </div>
);
```

`MobileTopBar` は新規 `src/components/nav/mobile-top-bar.tsx` で `Sheet` を使う。`SheetContent side="left" className="p-0 w-72"` の中で `<SidebarContent />` を呼び出す。

### Acceptance
- [ ] iPhone SE (375px) で横スクロールが発生しない。
- [ ] `lg` 未満で Sidebar が消え、ハンバーガーで開閉できる。
- [ ] Sheet 内部からのナビ遷移後に自動で閉じる（`onOpenChange`）。

---

## P1-2. ページ余白がモバイルで広すぎる

**現状**: 全ページで `px-8 py-6`（128px / 96px の左右余白）が固定。狭画面でコンテンツ幅が極端に狭まる。

**修正方針**: `px-4 sm:px-6 lg:px-8` のレスポンシブ余白に統一。

### 該当ファイル / 行
すべての page で `flex-1 px-8 py-6` を grep し置換:
- [src/app/(app)/inbox/page.tsx:23](src/app/(app)/inbox/page.tsx#L23)
- [src/app/(app)/agents/page.tsx:56](src/app/(app)/agents/page.tsx#L56)
- [src/app/(app)/agents/[id]/page.tsx:59](src/app/(app)/agents/[id]/page.tsx#L59)
- [src/app/(app)/agents/new/page.tsx:13](src/app/(app)/agents/new/page.tsx#L13)
- [src/app/(app)/cost/page.tsx:74](src/app/(app)/cost/page.tsx#L74)
- [src/app/(app)/runs/page.tsx:38](src/app/(app)/runs/page.tsx#L38)
- [src/app/(app)/pipeline/page.tsx:28](src/app/(app)/pipeline/page.tsx#L28)
- [src/components/nav/page-header.tsx:13](src/components/nav/page-header.tsx#L13) の `px-8 py-5` も同様に。

**before**: `className="flex-1 px-8 py-6"`
**after**: `className="flex-1 px-4 sm:px-6 lg:px-8 py-6"`

PageHeader は `className="border-b px-4 sm:px-6 lg:px-8 py-4 sm:py-5 …"`。

> ※ 1ファイルずつ手で書き換えるよりも、定数化を兼ねて `src/components/nav/page-shell.tsx` を新規作成し、`<PageShell>{children}</PageShell>` に置き換える方が将来のメンテが楽。最低でも今回は `Tailwind`変数化を推奨。

---

## P1-3. Inbox / Agents テーブルが横長で狭画面で破綻

**現状**:
- [src/app/(app)/inbox/inbox-list.tsx:90-247](src/app/(app)/inbox/inbox-list.tsx#L90-L247): 7 列 + 右寄せアクション 4ボタン。
- [src/app/(app)/agents/page.tsx:65-149](src/app/(app)/agents/page.tsx#L65-L149): 10 列。

中型モニタでも横スクロールが発生し、操作ボタンに辿り着くまで視線移動が長い。

**修正方針**:
1. テーブルは `<div className="overflow-x-auto rounded-md border">` で囲み、最低限の横スクロール対応にする。
2. **Inbox** は `lg` 未満ではテーブルではなく **カードリスト**に切り替え（情報設計の優先順位を直す）:
   - 行頭：商品名 + 優先度バッジ
   - 2行目：エージェント / ステージ / 経過時間
   - 3行目：アクションボタン群
3. **Agents** は列を以下に絞り、残りはツールチップまたは詳細ページで:
   - 主要列: System / 名称 / 状態 / 24h実行 / 一致率 / 平均応答
   - サブ列（ID / 同時実行 / 24h失敗 / 30d人却下率）→ 「詳細を表示」expand or 別タブ。

### 修正対象（最小ステップ）

#### Step 1: 横スクロールラッパー追加（即時対応）

**[src/app/(app)/inbox/inbox-list.tsx:91-93](src/app/(app)/inbox/inbox-list.tsx#L91-L93)**

before:
```tsx
<div className="rounded-md border">
  <Table>
```
after:
```tsx
<div className="rounded-md border overflow-x-auto">
  <Table className="min-w-[920px]">
```

同じく [src/app/(app)/agents/page.tsx:65-67](src/app/(app)/agents/page.tsx#L65-L67) は `min-w-[1100px]`。

#### Step 2: Inbox のモバイルカードビュー（推奨）

`InboxList` 内で:
```tsx
{/* Desktop */}
<div className="hidden lg:block rounded-md border overflow-x-auto">
  <Table>…既存…</Table>
</div>

{/* Mobile */}
<ul className="lg:hidden flex flex-col gap-3">
  {items.map((item) => (
    <li key={item.id} className="rounded-md border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{item.productTitle ?? "(商品未紐付け)"}</div>
          <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-1.5 items-center">
            <Badge variant="outline">{item.productStage ?? "—"}</Badge>
            <span>{item.agentId ?? "—"}</span>
            <span>· {formatDistanceToNow(item.createdAt, { addSuffix: true, locale: ja })}</span>
          </div>
        </div>
        <Badge variant={item.priority > 0 ? "default" : "secondary"}>P{item.priority}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {/* 既存のアクションボタンを再利用 */}
      </div>
    </li>
  ))}
</ul>
```

### Acceptance
- [ ] 1280px 幅で全ページ横スクロール無し。
- [ ] 768px 幅で Inbox はカード表示、操作ボタンが折り返さず触れる。

---

## P1-4. Agent 詳細ページの情報がフラットで構造が伝わらない

**現状**: [src/app/(app)/agents/[id]/page.tsx:59-174](src/app/(app)/agents/[id]/page.tsx#L59-L174) で 5 セクションが縦に並ぶだけ。スクロール量が多く、「テスト実行」までに辿り着かない。

**修正方針**: `src/components/ui/tabs.tsx` を使って 3タブに整理。
- **概要 (Overview)**: バッジ群 + 直近の不一致 + 実行ログへのリンク
- **プロンプト**: プロンプト履歴 + 新バージョン作成
- **テスト実行**: TestRunPanel（dynamic agentのときのみ表示）

### 該当ファイル
[src/app/(app)/agents/[id]/page.tsx](src/app/(app)/agents/[id]/page.tsx) を以下の構造へ:

```tsx
<Tabs defaultValue="overview" className="px-4 sm:px-6 lg:px-8 py-6">
  <TabsList>
    <TabsTrigger value="overview">概要</TabsTrigger>
    <TabsTrigger value="prompts">プロンプト</TabsTrigger>
    {agent.isDynamic ? <TabsTrigger value="test">テスト実行</TabsTrigger> : null}
  </TabsList>

  <TabsContent value="overview" className="flex flex-col gap-8 mt-6">
    {/* バッジ群 (line 60-75) */}
    {/* 不一致セクション (line 101-139) */}
    {/* 実行ログリンク (line 164-171) */}
  </TabsContent>

  <TabsContent value="prompts" className="flex flex-col gap-8 mt-6">
    {/* プロンプト履歴 (line 77-99) */}
    {/* 新バージョン作成 (line 141-151) */}
  </TabsContent>

  {agent.isDynamic ? (
    <TabsContent value="test" className="mt-6">
      <TestRunPanel agentId={agent.id} />
    </TabsContent>
  ) : null}
</Tabs>
```

「このエージェントの実行ログを見る」リンクは [page.tsx:164-171](src/app/(app)/agents/[id]/page.tsx#L164-L171) のような独立カード配置ではなく、`PageHeader` の `action` に **Button (variant="outline")** で配置。

```tsx
<PageHeader
  title={agent.name}
  description={agent.description ?? undefined}
  breadcrumb={…}
  action={
    <Button variant="outline" render={<Link href={`/runs?agent=${encodeURIComponent(agent.id)}`} />}>
      <ScrollText className="size-4" />
      実行ログ
    </Button>
  }
/>
```

### Acceptance
- [ ] 詳細ページのスクロール量が初期表示で 1〜1.5 画面に収まる。
- [ ] Tab を切り替えても URL/状態が破壊されない（`defaultValue` で十分）。

---

# Phase 2 — 操作フィードバックと可読性

## P2-1. ボタンに loading スピナーが無い（押した瞬間の反応が薄い）

**現状**:
- [inbox-list.tsx:154-216](src/app/(app)/inbox/inbox-list.tsx#L154-L216) は `disabled={isPending}` のみで、ユーザに「処理中」が伝わらない。
- [decision-dialog.tsx:80-101](src/app/(app)/inbox/decision-dialog.tsx#L80-L101) の submit ボタンも同様。
- [prompt-editor.tsx:74-95](src/app/(app)/agents/[id]/prompt-editor.tsx#L74-L95) は文字「実行中…」のみ。
- [test-run-panel.tsx:38-56](src/app/(app)/agents/[id]/test-run-panel.tsx#L38-L56) も同上。

**修正方針**: `lucide-react` の `Loader2` を `animate-spin` で表示する共通パターンに統一。

### 共通スニペット
```tsx
import { Loader2 } from "lucide-react";

<Button disabled={submitting}>
  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
  {submitting ? "承認中…" : "承認"}
</Button>
```

### 適用箇所
| ファイル | 行 | 変更 |
| --- | --- | --- |
| inbox-list.tsx | 154-167 (担当する) | `isPending` 中に `Loader2` |
| inbox-list.tsx | 169-184 (解除) | 同上 |
| inbox-list.tsx | 186-200 (承認) | 同上 |
| inbox-list.tsx | 201-215 (却下) | 同上 |
| decision-dialog.tsx | 87-100 | `submitting` 中に `Loader2` |
| prompt-editor.tsx | 74-95 | `submitting` 中に `Loader2` |
| test-run-panel.tsx | 39-55 | `submitting` 中に `Loader2` |

> 共通化したい場合は `<Button>` の slot として `loading?: boolean` prop を追加し、`children` の前に Spinner を差し込む変種を作っても良い。最小修正なら call site で個別に。

### Acceptance
- [ ] すべての非同期ボタンが押下後にスピナーを出す。
- [ ] 連打しても二重発火しない（既に `disabled` 済みなのでロジックOK）。

---

## P2-2. 一覧ページに件数表示・空白時のCTAが無い

**現状**:
- 一覧上部に「全○件」「今月の表示」のような件数情報がない。
- Empty state の [empty-state.tsx](src/components/empty-state.tsx) には CTA が無い（`hint`しかない）。

**修正方針**:
1. `EmptyState` に `action?: React.ReactNode` を足す。
2. Inbox / Agents / Runs の表上部に件数を出す。

### 修正
[src/components/empty-state.tsx](src/components/empty-state.tsx) を以下に変更:

before (line 1-25):
```tsx
export function EmptyState({ title, description, hint }: { … }) {
  return (
    <Card className="m-8">
      <CardContent className="py-12 text-center">
        <h3 className="text-base font-medium">{title}</h3>
        {description ? <p…>{description}</p> : null}
        {hint ? <div…>{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
```

after:
```tsx
import { Inbox } from "lucide-react";

export function EmptyState({
  title, description, hint, action, icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium">{title}</h3>
        {description ? <p className="text-sm text-muted-foreground max-w-sm">{description}</p> : null}
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}
```

> `m-8` は呼び出し側のレイアウトを侵食するので削除。呼び出し側で margin を持つ。

### 件数表示
**[src/app/(app)/inbox/inbox-list.tsx:91](src/app/(app)/inbox/inbox-list.tsx#L91)** の table の直前に追加:
```tsx
<div className="flex items-center justify-between mb-3">
  <p className="text-sm text-muted-foreground">{items.length} 件の未処理</p>
  {/* 将来: フィルタ・ソート */}
</div>
```

同じく Agents (line 64), Runs (line 43), Cost(rows用) にも `件数 + 期間ラベル` を追加。

### DBエラーCTA
[src/components/empty-state.tsx:27-39](src/components/empty-state.tsx#L27-L39) の `DbErrorState` には「再読み込み」ボタンを追加:
```tsx
action={
  <Button variant="outline" onClick={() => window.location.reload()}>
    <RotateCw className="size-3.5" />
    再読み込み
  </Button>
}
```
（`"use client"` 化が必要なので、`DbErrorState` だけ別ファイルにするか `<form action="…"/>` のSSR版で代替）

---

## P2-3. 「却下」ボタンに対する誤タップ防御が弱い

**現状**: [decision-dialog.tsx:64-78](src/app/(app)/inbox/decision-dialog.tsx#L64-L78) の textarea は **任意**。却下時はメモが「次回 few-shot に使われる」と本文に書いてあるのに空でも押せる。

**修正方針**: 却下時のみ `note.trim().length === 0` で submit を disable。承認時は任意のまま。

### 修正
[src/app/(app)/inbox/decision-dialog.tsx:87-100](src/app/(app)/inbox/decision-dialog.tsx#L87-L100):

before:
```tsx
<Button
  variant={isApprove ? "default" : "destructive"}
  disabled={submitting}
  onClick={…}
>
```
after:
```tsx
<Button
  variant={isApprove ? "default" : "destructive"}
  disabled={submitting || (!isApprove && note.trim().length === 0)}
  onClick={…}
>
```
さらに、却下時の placeholder の上に `<p className="text-xs text-muted-foreground">却下時はメモ必須です（再学習に使われます）。</p>` を追加し、ユーザに必須であることを伝える。

---

## P2-4. Agents 一覧の「一致率」色分けに凡例が無い & 列が多すぎ

**現状**:
- [src/app/(app)/agents/page.tsx:35-42](src/app/(app)/agents/page.tsx#L35-L42) で 0.8/0.6 を境に 3色だが、ユーザに閾値が伝わらない。
- 10列 + ID と名称が両方リンク化されており冗長。

**修正方針**:
1. ヘッダーの説明欄に凡例を追加。
2. ID 列を削除し、名称のリンクに `id` を `text-xs text-muted-foreground` でサブ表示。

### 修正

**[src/app/(app)/agents/page.tsx:46-55](src/app/(app)/agents/page.tsx#L46-L55)** の `description` を変更:
```tsx
description="直近24h の稼働 / 直近30日の品質。一致率 ≥80% 緑系・60–80% 黄・<60% 赤"
```

**[src/app/(app)/agents/page.tsx:69-80](src/app/(app)/agents/page.tsx#L69-L80)** の TableHeader から ID 列を削除:
```tsx
<TableRow>
  <TableHead>System</TableHead>
  <TableHead>名称</TableHead>
  <TableHead>状態</TableHead>
  <TableHead className="text-right">同時実行</TableHead>
  <TableHead className="text-right">24h 実行</TableHead>
  <TableHead className="text-right">24h 失敗</TableHead>
  <TableHead className="text-right">30d 一致率</TableHead>
  <TableHead className="text-right">30d 人却下率</TableHead>
  <TableHead className="text-right">平均応答</TableHead>
</TableRow>
```

**[src/app/(app)/agents/page.tsx:89-104](src/app/(app)/agents/page.tsx#L89-L104)** の 名称セルを以下に統合:
```tsx
<TableCell>
  <Link
    href={`/agents/${encodeURIComponent(a.id)}`}
    className="block hover:underline"
  >
    <div className="font-medium">{a.name}</div>
    <div className="font-mono text-xs text-muted-foreground">{a.id}</div>
  </Link>
</TableCell>
```
（ID列は完全削除）

### Acceptance
- [ ] 列数が 10 → 9 になり、ID と 名称が 1セルに統合される。
- [ ] ヘッダー説明で閾値が分かる。

---

## P2-5. プロンプトエディタの操作性

**現状**: [src/app/(app)/agents/[id]/prompt-editor.tsx](src/app/(app)/agents/[id]/prompt-editor.tsx)
- `rows={12}` 固定で長文編集つらい
- ネイティブ `<input type="checkbox">` なのでフォーカスリング無く目立たない（line 56-61）
- リセットが `notes` の変更を破壊
- Ctrl+Enter / Cmd+Enter のショートカットなし

**修正方針**:
1. textarea を `min-h-[280px] max-h-[60vh] resize-y` に。
2. checkbox は `src/components/ui/` に shadcn checkbox を導入（無ければ追加）。または以下の最小スタイル:
   ```tsx
   <input
     type="checkbox"
     checked={activate}
     onChange={(e) => setActivate(e.target.checked)}
     className="size-4 rounded border-input accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
   />
   ```
3. `onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save(); }}` を textarea に。
4. リセットの確認: 編集中（initialと差分あり）の時のみ enable、押下時に `confirm("変更を破棄しますか？")`。

### 修正
[prompt-editor.tsx:35-42](src/app/(app)/agents/[id]/prompt-editor.tsx#L35-L42):

before:
```tsx
<textarea
  id="system-prompt"
  value={systemPrompt}
  onChange={(e) => setSystemPrompt(e.target.value)}
  rows={12}
  className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
  placeholder="LLMに渡すSystemプロンプトを記述..."
/>
```

after:
```tsx
<textarea
  id="system-prompt"
  value={systemPrompt}
  onChange={(e) => setSystemPrompt(e.target.value)}
  onKeyDown={(e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && systemPrompt.trim()) {
      e.preventDefault();
      save(); // 既存の保存ロジックを関数化
    }
  }}
  className="w-full min-h-[280px] max-h-[60vh] resize-y rounded-md border bg-background px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
  placeholder="LLMに渡す System プロンプトを記述... （⌘ + Enter で保存）"
/>
```

リセット ([line 64-72](src/app/(app)/agents/[id]/prompt-editor.tsx#L64-L72)):
```tsx
<Button
  variant="ghost"
  type="button"
  disabled={submitting || (systemPrompt === initialSystemPrompt && notes === "")}
  onClick={() => {
    if (window.confirm("変更を破棄しますか？")) {
      setSystemPrompt(initialSystemPrompt);
      setNotes("");
    }
  }}
>
  リセット
</Button>
```

---

## P2-6. Runs / Cost の数値が読みづらい

**現状**:
- [src/app/(app)/runs/page.tsx:75-77](src/app/(app)/runs/page.tsx#L75-L77): `$0.0004` のような少数4桁が並ぶ → 縦に揃いにくい。
- [src/app/(app)/cost/page.tsx:88-89](src/app/(app)/cost/page.tsx#L88-L89): KPI Card は `font-semibold` だけで強弱が薄い。
- Cost テーブル (line 184-189) も同じく 4桁。

**修正方針**:
1. 通貨フォーマットは `Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 })` を共通関数 `formatUsd(n)` に切り出し（`src/lib/utils.ts`）。
2. KPI 数値は `text-3xl font-bold tabular-nums` に格上げ。
3. 数値カラム全体に `font-mono tabular-nums text-right` を統一。

### 共通ユーティリティ追加
[src/lib/utils.ts](src/lib/utils.ts) に追加:
```ts
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
export const formatUsd = (n: number | string) => usdFormatter.format(Number(n));

const numFormatter = new Intl.NumberFormat("ja-JP");
export const formatNum = (n: number | string) => numFormatter.format(Number(n));
```

### Cost ページ KPI 強化
[src/app/(app)/cost/page.tsx:80-126](src/app/(app)/cost/page.tsx#L80-L126) を以下に置換:
```tsx
<Card>
  <CardHeader className="pb-2">
    <CardTitle className="text-xs font-medium text-muted-foreground tracking-wide uppercase">本日</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="text-3xl font-bold tabular-nums">{formatUsd(totalToday)}</div>
    <p className="text-xs text-muted-foreground mt-1">前日比は v0.2 で対応予定</p>
  </CardContent>
</Card>
```
※ 4枚すべて同様に。トークン枚は通貨ではないので `text-3xl font-bold tabular-nums` に `formatNum` を使う。

### Runs / Cost テーブル数値の統一
すべての `text-right font-mono text-xs` を **`text-right font-mono tabular-nums text-xs`** に置換。

### Acceptance
- [ ] KPI Card が `text-3xl` で目に飛び込む。
- [ ] 数値が縦に揃う。

---

## P2-7. Sidebar に未処理件数バッジが無い

**現状**: [src/components/nav/sidebar.tsx:18-24](src/components/nav/sidebar.tsx#L18-L24) のメニュー項目はテキスト＋アイコンのみ。Inbox に何件溜まっているかを Sidebar から把握できない。

**修正方針**:
1. `(app)/layout.tsx` で `getOpenApprovalsCount()`（新規 query）を呼び、Sidebar に渡す。
2. Sidebar 各 item に `badge?: number` を表示。

### 新規 query
[src/lib/db/queries.ts](src/lib/db/queries.ts) に追加:
```ts
export async function getOpenApprovalsCount(): Promise<number> {
  const r = await db
    .select({ c: sql<number>`count(*)` })
    .from(approvalQueue)
    .where(eq(approvalQueue.status, "open"));
  return Number(r[0]?.c ?? 0);
}
```

### Sidebar 拡張
[sidebar.tsx](src/components/nav/sidebar.tsx) で `items` を関数化、prop で `inboxCount` を受け取り `Inbox` 行に Badge を出す:
```tsx
{active ? null : item.badge && item.badge > 0 ? (
  <Badge variant="secondary" className="ml-auto">{item.badge}</Badge>
) : null}
```

### Acceptance
- [ ] Inbox 横に未処理件数（>0時のみ）が出る。

---

# Phase 3 — アクセシビリティ・ポリッシュ

## P3-1. アクセシビリティ修正（最低限の WCAG 対応）

| 箇所 | 問題 | 修正 |
| --- | --- | --- |
| [prompt-history-row.tsx:40-50](src/app/(app)/agents/[id]/prompt-history-row.tsx#L40-L50) の expand ボタン | `aria-expanded` / `aria-label` なし | `aria-expanded={expanded} aria-label={expanded ? "プロンプトを閉じる" : "プロンプトを表示"}` |
| [agents/page.tsx:123](src/app/(app)/agents/page.tsx#L123) の一致率セル | 色だけで合否を伝える | テキスト末尾に `▲ / ◯ / ▼` のような形を併記、または `aria-label="一致率 65% (要注意)"` |
| [login/page.tsx:59-61](src/app/login/page.tsx#L59-L61) のエラー表示 | `role="alert"` なし | `<p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>` |
| [decision-dialog.tsx:60](src/app/(app)/inbox/decision-dialog.tsx#L60) の DialogDescription | `break-all` で英文も無理に折る | `break-words` に変更 |
| [sidebar.tsx:42-55](src/components/nav/sidebar.tsx#L42-L55) の Link | active 時のスタイルが背景色のみ | `aria-current={active ? "page" : undefined}` を追加し、左に `before:bg-primary` の 2px ボーダーを足す |

### Sidebar active の左ボーダー（具体）
before (line 45-50):
```tsx
className={cn(
  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
  active
    ? "bg-sidebar-accent text-sidebar-accent-foreground"
    : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
)}
```
after:
```tsx
aria-current={active ? "page" : undefined}
className={cn(
  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
  active
    ? "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
    : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
)}
```

---

## P3-2. Pipeline カードに情報を足す

**現状**: [src/app/(app)/pipeline/page.tsx:48-64](src/app/(app)/pipeline/page.tsx#L48-L64) のカードは `title` / `asin` / `status` のみ。

**修正方針**: 経過日数（`updatedAt`）と「最終アクション」を1行追加。

```tsx
<div key={p.id} className="rounded-md border bg-card p-3 text-xs hover:border-foreground/30 transition-colors">
  <div className="font-medium line-clamp-2">{p.title}</div>
  <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground">
    {p.asin && <span className="font-mono">{p.asin}</span>}
    <Badge variant="outline" className="text-[10px]">{p.status}</Badge>
  </div>
  <div className="mt-1 text-[10px] text-muted-foreground">
    更新 {formatDistanceToNow(p.updatedAt, { addSuffix: true, locale: ja })}
  </div>
</div>
```

各カラムのヘッダーも:
```tsx
<CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
  <div>
    <CardTitle className="text-sm">{label}</CardTitle>
    <p className="text-[11px] text-muted-foreground">{items.length} 件</p>
  </div>
  <Badge variant="secondary">{items.length}</Badge>
</CardHeader>
```
（title 直下に サブテキストを足し、Badge は 数値強調用に残す）

---

## P3-3. Runs ページのドリルダウンを用意

**現状**: 行をクリックしても何も起きない。エージェント詳細での「実行ログを見る」から来た時、個別 run の payload / output が見れる導線がない。

**修正方針**: `/runs/[id]` ルートを新設し、`agent_runs.input_payload` / `output` / `error` を JSON ビューワで表示。最低限の情報は今回はモーダル風 Sheet でも可。

最小実装:
```tsx
// runs/page.tsx の TableRow を Link 化
<TableRow
  key={r.id}
  className="cursor-pointer hover:bg-muted/40"
  onClick={() => router.push(`/runs/${r.id}`)}  // クライアント化が必要
>
```
クライアント化が嫌なら `<Link>` を `TableCell` 内で `block` にして wrap。

---

## P3-4. 共通フィードバック: トースト位置 と 新着リアルタイム通知

- [src/app/layout.tsx:33](src/app/layout.tsx#L33) の Toaster は `top-right` 固定。モバイルでサイドバートグル領域と被るので、`mobile: top-center, desktop: top-right` を CSS で振り分けるか `top-right` 固定でもOK。
- [inbox-list.tsx:42-58](src/app/(app)/inbox/inbox-list.tsx#L42-L58) のリアルタイム購読でデータ反映は `router.refresh()` のみ。**新着行が増えた**ときに `toast.info("新しい承認候補が届きました")` を発火する。

### 実装
```tsx
const [, startTransition] = useTransition();
const knownIds = useRef(new Set(initial.map((i) => i.id)));

useEffect(() => {
  const supabase = createSupabaseBrowserClient();
  const channel = supabase
    .channel("approval_queue_inbox")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "approval_queue" },
      (payload) => {
        const id = (payload.new as { id?: string }).id;
        if (id && !knownIds.current.has(id)) {
          knownIds.current.add(id);
          toast.info("新しい承認候補が届きました");
        }
        startTransition(() => router.refresh());
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "approval_queue" },
      () => startTransition(() => router.refresh())
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [router]);
```

---

## P3-5. デザイントークンの微調整

**現状の `globals.css` の所感**:
- グレースケール中心の OKLCH パレットで上品だが、**情報の優先度を伝える色がない**（primary も無彩色）。Inbox の「承認」CTA が黒で、「却下」が赤、「担当する」がアウトライン → 承認の重要性が視覚的に区別されにくい。
- ダーク時の chart-1〜5 が単調なグレースケール。

**修正方針** ([src/app/globals.css:51-117](src/app/globals.css#L51-L117)):
- `--primary` を 1色だけブランドカラー（例: 青 `oklch(0.55 0.18 250)`）に。primary-foreground は `oklch(0.985 0 0)` のまま。
- `--ring` も同色に合わせる。
- `--chart-1`〜`--chart-5` は 5色のカテゴリカルパレット（青→緑→黄→赤→紫）に置き換え。

> ブランド方針が固まっていないなら今回はスキップ可。やる場合は light/dark 両方で同時に調整。

---

# Phase 4 — デザイン感性のポリッシュ

> 70点 → 100点を分けるのは「視覚的なリズム・余白・色の意味」。実装としては小さい変更が多いが、体感は跳ねる。

## P4-1. ブランドアクセント色を 1色だけ入れる

**意図**: 現状は完全グレースケールで上品だが「個性が無い」。プライマリーアクションと "稼働中" だけで使う**ブランド色 1色**を入れると印象が締まる。

**推奨**: 落ち着いた **インディゴ** (`oklch(0.55 0.18 265)`)。SaaS 管理画面の定番。

[src/app/globals.css:51-83](src/app/globals.css#L51-L83):
```css
:root {
  --primary: oklch(0.55 0.18 265);          /* indigo */
  --primary-foreground: oklch(0.985 0 0);
  --ring: oklch(0.55 0.18 265);
  /* sidebar-primary も同色に */
  --sidebar-primary: oklch(0.55 0.18 265);
  --sidebar-ring: oklch(0.55 0.18 265);
  /* chart palette はカテゴリカルに */
  --chart-1: oklch(0.62 0.16 250);  /* blue   */
  --chart-2: oklch(0.7  0.16 145);  /* green  */
  --chart-3: oklch(0.78 0.15 75);   /* amber  */
  --chart-4: oklch(0.62 0.2  20);   /* red    */
  --chart-5: oklch(0.55 0.2  300);  /* violet */
}
```
ダーク側も同色相で `oklch(0.65 0.17 265)` に上げる。

これだけで Sidebar の active item / Inbox の「承認」CTA / フォーカスリングが青になり、「**この色がプライマリー**」というブランドメッセージが立つ。

---

## P4-2. ステータスバッジの「重さ」を整える

**現状の問題**: 「有効」「自分」「アクティブ」など `<Badge variant="default">` で塗り潰しの黒が並ぶと**情報の優先度が逆転**する（行の本質より badge が目立つ）。

**原則**:
| 用途 | variant | 例 |
| --- | --- | --- |
| 主たる属性（一意のラベル） | `outline` + 色付き dot | 「Scout」「LP」 |
| ON/OFF 状態 | dot + テキスト（バッジを使わない） | 「● 稼働中」 |
| 強調が必要な数値 | `secondary`（grey） | 件数・カウント |
| アラート | `destructive` 系の薄い背景 | 「却下」「失敗 3」 |
| 一意の警告/重要 | `default`（黒/ブランド色塗り）— **ここぞの場面だけ** | 「自分」「アクティブ v3」 |

具体的な置換:
- [inbox-list.tsx:136](src/app/(app)/inbox/inbox-list.tsx#L136) `<Badge>自分</Badge>` → そのまま黒塗りでOK（**自分の担当**は強調が要る）。
- [agents/page.tsx:107](src/app/(app)/agents/page.tsx#L107) 「有効」 → P0-3 の `StatusDot` に置換。
- [prompt-history-row.tsx:54](src/app/(app)/agents/[id]/prompt-history-row.tsx#L54) `<Badge>アクティブ</Badge>` → 黒塗り維持（一意なのでOK）。
- すべての `<Badge variant="outline">` で英数字（System名、ID）が並ぶケース → font は `font-mono` 維持、ただし `text-[10.5px] font-normal` でやや軽くする。

---

## P4-3. タイポグラフィの段差を強くする

**観察**: ページタイトル `text-xl`、セクション見出し `text-lg`、本文 `text-sm` の段差が弱い。視線誘導が成立しない。

**修正**: [src/components/nav/page-header.tsx:16](src/components/nav/page-header.tsx#L16):
```tsx
<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
```
`text-xl` → `text-2xl`。description も `text-sm` → `text-[13px]` で明示的に小さく。

セクション見出し `text-lg font-semibold` を採用している全ページ（[agents/[id]/page.tsx:79](src/app/(app)/agents/[id]/page.tsx#L79), [skills/[id]/page.tsx:55](src/app/(app)/skills/[id]/page.tsx#L55) 等）はそのまま、ただし上に **`text-xs uppercase tracking-wider text-muted-foreground`** で小ラベルを足すと「カテゴリ感」が出る:

```tsx
<div>
  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
    Section
  </p>
  <h2 className="text-lg font-semibold">プロンプト履歴</h2>
</div>
```

---

## P4-4. テーブル・カードの「呼吸」を増やす

**現状**: テーブルの `py` 余白が詰まり気味、カードの padding `p-4` が一律で単調。

**Card / TableCell の余白指針**:
- 一覧 Table の TableCell: `py-3` を `py-4` に。Inbox/Agents/Cost/Runs すべて。
- KPI Card の `CardContent`: `py-4` → `py-5`、`text-3xl` の数値の上下に `mt-0.5` を入れる。
- セクション間隔: `gap-6` → `gap-8` を基本に。詳細ページの section gap がすでに `gap-8` なので、サブセクション内も `gap-4` で統一。

`src/components/ui/table.tsx` の base スタイルが触れるならそこで `py-4` を default にしても良い。

---

## P4-5. 「数字の縦揃え」を全面 tabular-nums

**現状**: 数値カラムが `font-mono` だけで `tabular-nums` が無い。プロポーショナル数字でも mono なら問題ないが、Inter / Geist のような可変幅 mono だと微妙にずれる。

**修正**: 数値が並ぶ場所すべてに `tabular-nums` を併記。最低限以下のクラスを追加:

```diff
- className="text-right font-mono text-xs"
+ className="text-right font-mono tabular-nums text-xs"
```

該当: [agents/page.tsx](src/app/(app)/agents/page.tsx) / [runs/page.tsx](src/app/(app)/runs/page.tsx) / [cost/page.tsx](src/app/(app)/cost/page.tsx)。

`globals.css` で一括適用も可:
```css
@layer base {
  .font-mono { font-variant-numeric: tabular-nums; }
}
```

---

## P4-6. インタラクションの「気持ち良さ」

小さいけれど効くアニメーション/フィードバック:

| 場所 | 現状 | 改善 |
| --- | --- | --- |
| Sidebar Link | hover で背景色が即座に変わる | `transition-[background-color,color] duration-150 ease-out` 維持、active の `before:` 色帯を `transition-transform origin-top` でスケールイン |
| Pipeline カード | hover で何も起きない | `hover:shadow-sm hover:-translate-y-0.5 transition-all duration-150` |
| TableRow | hover 無し | `hover:bg-muted/40 transition-colors` を全テーブルに |
| Toast (sonner) | デフォルト位置 `top-right` | OK。ただし `closeButton richColors` で richColors は既に有効 |
| Dialog | 開閉アニメは shadcn 標準 | OK |
| Skeleton | ローディング中の表示が無い | 各 page の Suspense fallback で `Skeleton` を使う（[agents/page.tsx](src/app/(app)/agents/page.tsx) は server component なので `loading.tsx` を作る） |

`src/app/(app)/agents/loading.tsx` を新規作成:
```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/nav/page-header";

export default function Loading() {
  return (
    <>
      <PageHeader title="エージェント稼働状況" description="…" />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        <div className="rounded-md border divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
```
同様に `inbox/loading.tsx`、`runs/loading.tsx`、`cost/loading.tsx`、`pipeline/loading.tsx`、`skills/loading.tsx` も作成。

---

## P4-7. 空・ゼロ・未取得の「見せ方」を整える

**問題**: 空データ・ゼロ・未取得を全部 `—` と「未割当」「商品なし」のテキストで処理しており、ユーザに「設定漏れ」「データ不足」「正常に空」の区別がつかない。

**3つのパターンを区別**:

1. **正常に空（運用上もあり得る空）**: 軽いアイコン + ニュートラル文言
   ```tsx
   <div className="text-muted-foreground/60 text-xs">未処理 0 件</div>
   ```
2. **計測前 / サンプル不足（n=0 や n<3）**: `text-muted-foreground/40` の `—`、ツールチップで理由
   ```tsx
   <span className="text-muted-foreground/40" title="判断付き run がまだありません">—</span>
   ```
3. **エラー / 取得失敗**: `DbErrorState` のように Card + 再読込 CTA

各 page を read 直して、上記の3パターンに振り分けて言葉を統一する（**全ページの「—」と「なし」を見直し、文脈に合わせて差分**）。

---

## P4-8. ダークモードの動作確認

**現状**: `globals.css` に `.dark` のトークンは揃っているが、ダーク切替UI が無い。実装漏れか意図的に未提供かを確認:
- ユーザにダークモード提供する場合: Sidebar 底部に `<ThemeToggle />` を追加（`next-themes` を導入）。
- ダーク提供しない場合: HTML から `class="dark"` の流入を防ぐ。

優先度は低いが、`prompt-fragment` の `<pre>` がダーク時に読みにくいなどの細かい不具合を一通り画面確認する必要あり。

---



着手前にこれをチェックリスト化し、Phase 完了ごとに目視確認:

### レスポンシブ
- [ ] 375 / 768 / 1024 / 1440 px すべてで横スクロール無し（Sidebar 切替後）
- [ ] Inbox がモバイルでカード表示

### 情報設計
- [ ] 各一覧の上部に件数表示
- [ ] Agents 一覧で ID と 名称が 1セルに統合、列数 9 以下
- [ ] Agent 詳細がタブ化されて初期表示が短い
- [ ] Cost KPI が `text-3xl` で視認できる

### 操作性
- [ ] すべての非同期ボタンがスピナー表示
- [ ] 却下時のみメモ必須でガード
- [ ] Sidebar に Inbox 件数バッジ
- [ ] DBエラー時に再読み込みCTA

### アクセシビリティ
- [ ] expand/collapse に `aria-expanded`
- [ ] サイドバー active に `aria-current="page"`
- [ ] login エラーに `role="alert"`
- [ ] 一致率の色判定にテキストラベル併記

### 感性ポリッシュ（Phase 4）
- [ ] ブランド色 1色（インディゴ）が primary / ring / sidebar-active で機能
- [ ] StatusDot / StatusBadge が定着し黒塗りバッジが乱用されていない
- [ ] 全テーブル数値が `tabular-nums` で揃う
- [ ] 各ルートに `loading.tsx` の skeleton が存在
- [ ] Pipeline カード hover で `-translate-y-0.5 + shadow-sm`
- [ ] 「—」「なし」「失敗」が文脈に応じて言い分けられる

---

# 参考: 触らない方が良い箇所

- `src/components/ui/*`（shadcn primitive）— 個別ページ側で wrap して対応する。
- `(app)/layout.tsx` の Supabase user 取得ロジック — UI 改修のスコープ外。
- `decision-dialog.tsx` の `DialogInner` 切り出し（line 21-32）— `key` 戦略は意図的なので維持。

---

最終更新: 2026-05-10
