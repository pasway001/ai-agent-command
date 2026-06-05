import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DbErrorState } from "@/components/empty-state";
import { SourceBadge } from "@/components/source-badge";
import { getScoutRunById, safe } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function formatJst(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function formatDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "danger" | "success" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}
        >
          {value}
        </div>
        {hint ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default async function ScoutRunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const run = await safe(() => getScoutRunById(id));

  if (run === null) {
    return (
      <>
        <PageHeader title="スカウト実行詳細" />
        <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
          <DbErrorState />
        </div>
      </>
    );
  }
  if (!run) notFound();

  const perFeed = Array.isArray(run.perFeed) ? run.perFeed : [];
  const errors = Array.isArray(run.errors) ? run.errors : [];
  const failedFeeds = perFeed.filter((f) => f && !f.fetched);

  return (
    <>
      <PageHeader
        title="スカウト実行詳細"
        breadcrumb={
          <Link
            href="/scout-runs"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← スカウト履歴
          </Link>
        }
        description={`${formatJst(run.startedAt)} (JST) · ${run.triggeredBy}`}
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        {/* Stat grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat
            label="フィード数"
            value={run.feedCount}
            hint={`${perFeed.filter((f) => f.fetched).length} 成功 / ${failedFeeds.length} 失敗`}
            tone={failedFeeds.length > 0 ? "danger" : "default"}
          />
          <Stat
            label="生件数"
            value={run.rawItemCount}
            hint="RSS全件"
            tone="muted"
          />
          <Stat
            label="物理通過"
            value={run.physicalCount}
            hint="classification後"
          />
          <Stat
            label="重複ドロップ"
            value={`-${run.dedupDroppedCount}`}
            tone="muted"
          />
          <Stat label="AI評価" value={run.scoredCount} hint="LLMに投げた数" />
          <Stat
            label="Inbox到着"
            value={run.enqueuedCount}
            tone={run.enqueuedCount > 0 ? "success" : "muted"}
          />
        </div>

        {/* Failed feeds banner */}
        {failedFeeds.length > 0 ? (
          <Card className="border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10">
            <CardContent className="py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="size-4 mt-0.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <div className="flex-1 text-sm text-rose-900 dark:text-rose-200">
                  <div className="font-medium">
                    {failedFeeds.length} 個のフィードで取得失敗
                  </div>
                  <ul className="mt-1 text-xs space-y-0.5">
                    {failedFeeds.map((f) => (
                      <li key={`${f.name}-${f.url}`} className="font-mono">
                        {f.name}: {f.errorMessage ?? "unknown"}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Per-feed table */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">ソース別内訳</h2>
          <div className="rounded-md border overflow-x-auto bg-card">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>ソース</TableHead>
                  <TableHead>地域</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">生件数</TableHead>
                  <TableHead className="text-right">物理通過</TableHead>
                  <TableHead className="text-right">重複後</TableHead>
                  <TableHead className="text-right">状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {perFeed.map((feed, idx) => (
                  <TableRow
                    key={`${feed.name}-${idx}`}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <TableCell>
                      <SourceBadge name={feed.name} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {feed.region === "japan" ? "国内" : "海外"}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-xs font-mono">
                      <a
                        href={feed.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <span className="truncate">{feed.url}</span>
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs">
                      {feed.rawItemCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs">
                      {feed.physicalItemCount}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-xs">
                      {feed.dedupSurvivorCount}
                    </TableCell>
                    <TableCell className="text-right">
                      {feed.fetched ? (
                        <Badge variant="secondary" className="font-normal">
                          OK
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="font-normal">
                          失敗
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* Raw errors */}
        {errors.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">エラーログ</h2>
            <Card>
              <CardContent className="py-3">
                <ul className="text-xs font-mono space-y-1 text-muted-foreground">
                  {errors.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {/* Timing */}
        <section className="text-xs text-muted-foreground tabular-nums flex flex-wrap gap-x-6 gap-y-1">
          <span>開始: {formatJst(run.startedAt)}</span>
          <span>終了: {formatJst(run.finishedAt)}</span>
          <span>処理時間: {formatDuration(run.durationMs)}</span>
          <span className="font-mono">id: {run.id}</span>
        </section>
      </div>
    </>
  );
}
