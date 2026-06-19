import Link from "next/link";
import {
  CircleDollarSign,
  ExternalLink,
  Mail,
  Save,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { SummaryCard } from "@/components/summary-card";
import { DbErrorState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductStatusBadge, StageBadge } from "@/components/status-badge";
import { getPipelineProductsByStage, safe } from "@/lib/db/queries";
import type { Product } from "@/lib/db/schema";
import {
  complianceNeeds,
  contactLookupHint,
  enBody,
  jaBody,
  mailtoHref,
} from "@/lib/sales/outreach-kit";
import {
  SALES_EXECUTION_LABELS,
  SALES_EXECUTION_STATUSES,
  SALES_EXECUTION_VIEWS,
  SALES_EXECUTION_VIEW_LABELS,
  followUpState,
  isActiveSalesStatus,
  parseSalesExecutionView,
  salesExecutionMatchesView,
  salesExecutionFromMetadata,
  type SalesExecutionView,
  type SalesExecution,
} from "@/lib/sales/execution";
import { updateSalesExecution } from "./actions";

export const dynamic = "force-dynamic";

type GroupedProducts = Awaited<ReturnType<typeof getPipelineProductsByStage>>;
type SalesProduct = GroupedProducts[Product["stage"]][number];
type SearchParams = Promise<{ view?: string }>;
type SalesProductRow = {
  rank: number;
  product: SalesProduct;
  execution: SalesExecution;
  followUp: ReturnType<typeof followUpState>;
};

function rankProducts(grouped: GroupedProducts) {
  return Object.values(grouped)
    .flat()
    .filter((product) => !product.title.startsWith("[SMOKE]"))
    .sort((a, b) => {
      const scoreA = a.pipelineSummary.shortlistScore ?? 0;
      const scoreB = b.pipelineSummary.shortlistScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const priorityA = a.pipelineSummary.salesPriority ?? 0;
      const priorityB = b.pipelineSummary.salesPriority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.title.localeCompare(b.title);
    });
}

function textFor(product: SalesProduct) {
  const summary = product.pipelineSummary;
  return [
    product.title,
    summary.japanAngle,
    summary.nextAction,
    summary.salesReasons.join(" "),
    summary.salesRisks.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function categoryFor(product: SalesProduct) {
  const text = textFor(product);
  if (/\b(sleep|mask|pillow|headphones|air purifier|wellness|calm)\b/i.test(text)) {
    return "ウェルネス/睡眠";
  }
  if (/\b(light|flashlight|bulb|speaker|dock|display|hub|earbuds|sensor|robot|joystick|clock)\b/i.test(text)) {
    return "ガジェット/家電";
  }
  if (/\b(bag|wallet|jewelry|watch|pins|pendants|earrings|wearable art)\b/i.test(text)) {
    return "ファッション/アクセサリー";
  }
  if (/\b(kitchen|cutting board|chef|coffee|bottle|shower)\b/i.test(text)) {
    return "キッチン/生活雑貨";
  }
  if (/\b(mower|tufting|tool|driver|controller|diy)\b/i.test(text)) {
    return "工具/ホビー";
  }
  return "生活改善プロダクト";
}

function priceRange(product: SalesProduct) {
  const text = textFor(product);
  if (/\b(robot|mower|machine|tufting|terminal|hub)\b/i.test(text)) {
    return { min: 39800, max: 99800 };
  }
  if (/\b(earbuds|headphones|speaker|dock|display|watch|air purifier|sleep system)\b/i.test(text)) {
    return { min: 12800, max: 39800 };
  }
  if (/\b(bag|pins|pendants|earrings|cutting board|flashlight|bulb|clock|sensor)\b/i.test(text)) {
    return { min: 4980, max: 14800 };
  }
  return { min: 8800, max: 24800 };
}

function complianceFlags(product: SalesProduct) {
  const risks = product.pipelineSummary.salesRisks.join(" ");
  return {
    pse: risks.includes("PSE"),
    giteki: risks.includes("技適"),
    food: risks.includes("食品衛生"),
    trademark: risks.includes("商標") || risks.includes("通常の輸入"),
  };
}

function targetLandedCostMax(retailMin: number) {
  return Math.floor(retailMin * 0.35);
}

function grossProfitAtTarget(retailMin: number) {
  const landed = targetLandedCostMax(retailMin);
  return {
    landed,
    grossProfit: retailMin - landed,
    grossMarginPct: Math.round(((retailMin - landed) / retailMin) * 100),
  };
}

function yen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}

function scoreAverage(products: SalesProduct[]) {
  const scores = products
    .map((product) => product.pipelineSummary.shortlistScore)
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return "-";
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function regulationRequired(product: SalesProduct) {
  const flags = complianceFlags(product);
  return flags.pse || flags.giteki || flags.food;
}

function dateInputValue(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

function salesStatusVariant(status: SalesExecution["status"]) {
  if (status === "won") return "default";
  if (status === "lost" || status === "uncontacted") return "outline";
  return "secondary";
}

function followUpLabel(state: ReturnType<typeof followUpState>) {
  if (state === "overdue") return "期限超過";
  if (state === "today") return "本日確認";
  if (state === "upcoming") return "次回確認";
  return null;
}

function followUpVariant(state: ReturnType<typeof followUpState>) {
  if (state === "overdue") return "destructive";
  if (state === "today") return "secondary";
  return "outline";
}

function salesViewHref(view: SalesExecutionView) {
  return view === "all" ? "/sales" : `/sales?view=${view}`;
}

function countForView(
  rows: SalesProductRow[],
  view: SalesExecutionView,
  now: Date
) {
  return rows.filter((row) =>
    salesExecutionMatchesView(row.execution, view, now)
  ).length;
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { view } = await searchParams;
  const activeView = parseSalesExecutionView(view);
  const now = new Date();
  const grouped = await safe(() => getPipelineProductsByStage());

  if (grouped === null) {
    return (
      <>
        <PageHeader
          title="販売デスク"
          description="候補商品の仕入れ打診と販売条件確認を進めます。"
        />
        <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <DbErrorState />
        </div>
      </>
    );
  }

  const products = rankProducts(grouped).slice(0, 30);
  const rows = products.map((product, index) => {
    const execution = salesExecutionFromMetadata(product.metadata);
    return {
      rank: index + 1,
      product,
      execution,
      followUp: followUpState(execution, now),
    };
  });
  const visibleRows = rows.filter((row) =>
    salesExecutionMatchesView(row.execution, activeView, now)
  );
  const regulatedCount = products.filter(regulationRequired).length;
  const activeOutreachCount = rows.filter((row) =>
    isActiveSalesStatus(row.execution.status)
  ).length;
  const dueFollowUpCount = rows.filter((row) => {
    return row.followUp === "overdue" || row.followUp === "today";
  }).length;

  return (
    <>
      <PageHeader
        title="販売デスク"
        description="リサーチ済み候補をスコア順に確認し、仕入れ打診へ進めます。"
      />
      <div className="flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="候補"
            value={products.length}
            hint="スコア順の販売候補"
          />
          <SummaryCard
            label="平均スコア"
            value={scoreAverage(products)}
            hint="shortlist score"
            accent="emerald"
          />
          <SummaryCard
            label="規制確認"
            value={regulatedCount}
            hint="PSE/技適/食品衛生"
            accent={regulatedCount > 0 ? "amber" : "muted"}
          />
          <SummaryCard
            label="商談中"
            value={activeOutreachCount}
            hint="連絡済み以降"
            accent="default"
          />
          <SummaryCard
            label="本日対応"
            value={dueFollowUpCount}
            hint="期限超過/本日確認"
            accent={dueFollowUpCount > 0 ? "rose" : "muted"}
          />
        </div>

        <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-2">
          {SALES_EXECUTION_VIEWS.map((viewKey) => {
            const active = viewKey === activeView;
            return (
              <Button
                key={viewKey}
                nativeButton={false}
                render={<Link href={salesViewHref(viewKey)} />}
                variant={active ? "default" : "outline"}
                size="sm"
              >
                {SALES_EXECUTION_VIEW_LABELS[viewKey]}
                <span className="font-mono text-[11px]">
                  {countForView(rows, viewKey, now)}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="space-y-3">
          {visibleRows.length === 0 ? (
            <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
              該当商品なし
            </div>
          ) : null}
          {visibleRows.map(({ rank, product, execution, followUp }) => {
            const summary = product.pipelineSummary;
            const price = priceRange(product);
            const unit = grossProfitAtTarget(price.min);
            const flags = complianceFlags(product);
            const needs = complianceNeeds(product);
            const followUpText = followUpLabel(followUp);
            return (
              <article
                key={product.id}
                className="rounded-md border bg-background p-4 shadow-sm"
              >
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)_minmax(300px,0.9fr)]">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono">
                        #{rank}
                      </Badge>
                      {summary.shortlistScore !== null ? (
                        <Badge variant="outline" className="font-mono">
                          {summary.shortlistScore}点
                        </Badge>
                      ) : null}
                      {summary.salesPriority !== null ? (
                        <Badge variant="outline" className="font-mono">
                          P{summary.salesPriority}
                        </Badge>
                      ) : null}
                      <StageBadge stage={product.stage} />
                      <ProductStatusBadge status={product.status} />
                      <Badge variant="outline">{categoryFor(product)}</Badge>
                      <Badge variant={salesStatusVariant(execution.status)}>
                        {SALES_EXECUTION_LABELS[execution.status]}
                      </Badge>
                      {followUpText ? (
                        <Badge variant={followUpVariant(followUp)}>
                          {followUpText}
                        </Badge>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-base font-semibold leading-snug break-words">
                        {product.title}
                      </h2>
                      {summary.sourceUrl ? (
                        <a
                          href={summary.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground underline-offset-3 hover:underline"
                        >
                          <span className="truncate">
                            {summary.sourceName ?? "source"}
                          </span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : summary.sourceName ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {summary.sourceName}
                        </p>
                      ) : null}
                    </div>

                    {summary.japanAngle ? (
                      <p className="text-sm leading-6 text-foreground/80">
                        {summary.japanAngle}
                      </p>
                    ) : null}

                    {summary.nextAction ? (
                      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-foreground/80">
                        次: {summary.nextAction}
                      </p>
                    ) : null}
                    {execution.nextFollowUpAt ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        次回確認:{" "}
                        {new Date(execution.nextFollowUpAt).toLocaleDateString(
                          "ja-JP"
                        )}
                      </p>
                    ) : null}
                  </div>

                  <div className="self-start rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <CircleDollarSign className="size-4 text-emerald-600" />
                      価格と粗利目安
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">販売価格</div>
                        <div className="font-semibold tabular-nums">
                          {yen(price.min)} - {yen(price.max)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">着地原価上限</div>
                        <div className="font-semibold tabular-nums">
                          {yen(unit.landed)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">最低粗利</div>
                        <div className="font-semibold tabular-nums">
                          {yen(unit.grossProfit)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">粗利率</div>
                        <div className="font-semibold tabular-nums">
                          {unit.grossMarginPct}%
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {flags.pse ? <Badge variant="outline">PSE確認</Badge> : null}
                      {flags.giteki ? <Badge variant="outline">技適確認</Badge> : null}
                      {flags.food ? <Badge variant="outline">食品衛生確認</Badge> : null}
                      <Badge variant="outline">
                        {flags.trademark ? "商標/代理店確認" : "商標確認"}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-3 self-start">
                    <div className="rounded-md border bg-muted/20 p-3">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <ShieldCheck className="size-4 text-primary" />
                        初回確認項目
                      </div>
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-foreground/75">
                        {needs.slice(0, 6).map((need) => (
                          <li key={need}>・{need}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {contactLookupHint(product)}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        nativeButton={false}
                        render={
                          <a
                            href={mailtoHref(
                              product,
                              "ja",
                              execution.supplierEmail
                            )}
                          />
                        }
                        size="sm"
                      >
                        <Mail className="size-3.5" />
                        JP下書き
                      </Button>
                      <Button
                        nativeButton={false}
                        render={
                          <a
                            href={mailtoHref(
                              product,
                              "en",
                              execution.supplierEmail
                            )}
                          />
                        }
                        variant="outline"
                        size="sm"
                      >
                        <Mail className="size-3.5" />
                        EN draft
                      </Button>
                      {summary.sourceUrl ? (
                        <Button
                          nativeButton={false}
                          render={
                            <a
                              href={summary.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                          variant="outline"
                          size="sm"
                        >
                          <TrendingUp className="size-3.5" />
                          Source
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <form
                  action={updateSalesExecution}
                  className="mt-4 rounded-md border bg-muted/20 p-3"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium">販売記録</div>
                      {execution.updatedAt ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          最終更新 {new Date(execution.updatedAt).toLocaleString("ja-JP")}
                        </p>
                      ) : null}
                    </div>
                    <Button type="submit" size="sm">
                      <Save className="size-3.5" />
                      記録
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-[160px_1fr_1fr_160px]">
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">状態</span>
                      <select
                        name="salesStatus"
                        defaultValue={execution.status}
                        className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {SALES_EXECUTION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {SALES_EXECUTION_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">メール</span>
                      <Input
                        name="supplierEmail"
                        type="email"
                        defaultValue={execution.supplierEmail ?? ""}
                        placeholder="supplier@example.com"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">担当/URL</span>
                      <Input
                        name="contactName"
                        defaultValue={execution.contactName ?? ""}
                        placeholder="担当者名"
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">次回確認</span>
                      <Input
                        name="nextFollowUpAt"
                        type="date"
                        defaultValue={dateInputValue(execution.nextFollowUpAt)}
                      />
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">連絡先URL</span>
                      <Input
                        name="contactUrl"
                        type="url"
                        defaultValue={execution.contactUrl ?? ""}
                        placeholder="https://..."
                      />
                    </label>
                    <label className="space-y-1 text-xs">
                      <span className="text-muted-foreground">メモ</span>
                      <textarea
                        name="note"
                        defaultValue={execution.note ?? ""}
                        className="min-h-8 w-full resize-y rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        placeholder="条件、返信内容、次アクション"
                      />
                    </label>
                  </div>
                  {execution.history[0] ? (
                    <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                      履歴: {SALES_EXECUTION_LABELS[execution.history[0].status]} /{" "}
                      {new Date(execution.history[0].createdAt).toLocaleString("ja-JP")}
                      {execution.history[0].note ? ` / ${execution.history[0].note}` : ""}
                    </p>
                  ) : null}
                </form>

                <details className="mt-4 rounded-md border bg-muted/20 p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    メール本文
                  </summary>
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-[11px] leading-5 text-foreground/80">
                      {jaBody(product)}
                    </pre>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 text-[11px] leading-5 text-foreground/80">
                      {enBody(product)}
                    </pre>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
