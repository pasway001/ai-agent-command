import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
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
import { DbErrorState, EmptyState } from "@/components/empty-state";
import { getRecentScoutRuns, safe } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function formatDuration(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatJst(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export default async function ScoutRunsPage() {
  const runs = await safe(() => getRecentScoutRuns(30));

  return (
    <>
      <PageHeader
        title="スカウト履歴"
        description="どのソースを何件叩いたか、何件Inboxに届いたかの履歴 (最新30件)"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {runs === null ? (
          <DbErrorState />
        ) : runs.length === 0 ? (
          <EmptyState
            title="まだスカウト実行履歴はありません"
            description="cron か pnpm scout:minimal を回すとここに表示されます。"
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {runs.length} 件
              </p>
            </div>
            <div className="rounded-md border overflow-x-auto bg-card">
              <Table className="min-w-[920px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>実行日時 (JST)</TableHead>
                    <TableHead>経過</TableHead>
                    <TableHead>トリガー</TableHead>
                    <TableHead className="text-right">フィード</TableHead>
                    <TableHead className="text-right">物理</TableHead>
                    <TableHead className="text-right">重複落</TableHead>
                    <TableHead className="text-right">評価</TableHead>
                    <TableHead className="text-right">Inbox</TableHead>
                    <TableHead className="text-right">失敗</TableHead>
                    <TableHead className="text-right">時間</TableHead>
                    <TableHead className="text-right">詳細</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => {
                    const failedFeeds = Array.isArray(r.perFeed)
                      ? r.perFeed.filter((f) => f && !f.fetched).length
                      : 0;
                    return (
                      <TableRow
                        key={r.id}
                        className="hover:bg-muted/40 transition-colors"
                      >
                        <TableCell className="font-mono tabular-nums text-xs">
                          {formatJst(r.startedAt)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatDistanceToNow(r.startedAt, {
                            addSuffix: true,
                            locale: ja,
                          })}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.triggeredBy === "cron" ? "default" : "secondary"
                            }
                            className="font-normal"
                          >
                            {r.triggeredBy}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {r.rawItemCount}/{r.feedCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {r.physicalCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-muted-foreground">
                          -{r.dedupDroppedCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {r.scoredCount}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          <span
                            className={
                              r.enqueuedCount > 0
                                ? "font-semibold text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground"
                            }
                          >
                            {r.enqueuedCount}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {failedFeeds > 0 ? (
                            <span className="font-semibold text-rose-600 dark:text-rose-400">
                              {failedFeeds}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs text-muted-foreground">
                          {formatDuration(r.durationMs)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/scout-runs/${r.id}`}
                            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                          >
                            開く
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
