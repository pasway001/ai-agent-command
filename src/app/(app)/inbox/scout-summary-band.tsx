import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ScoutRun } from "@/lib/db/schema";

function formatJst(value: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

/**
 * Top-of-inbox banner summarizing the most recent scout_runs row.
 * One line, click-through to /scout-runs/[id]. Highlights failed feeds in red.
 */
export function ScoutSummaryBand({ run }: { run: ScoutRun | null }) {
  if (!run) {
    return (
      <Card className="mb-4 border-dashed">
        <CardContent className="py-3 text-xs text-muted-foreground">
          スカウト実行履歴がまだありません (cron か pnpm scout:minimal を実行してください)
        </CardContent>
      </Card>
    );
  }

  const perFeed = Array.isArray(run.perFeed) ? run.perFeed : [];
  const failed = perFeed.filter((f) => f && !f.fetched);
  const hasFailures = failed.length > 0;

  return (
    <Link
      href={`/scout-runs/${run.id}`}
      className="group block mb-4"
      aria-label="スカウト実行詳細を見る"
    >
      <Card
        className={
          hasFailures
            ? "border-rose-200 bg-rose-50/40 dark:border-rose-500/20 dark:bg-rose-500/5 transition-colors hover:bg-rose-50/70 dark:hover:bg-rose-500/10"
            : "transition-colors hover:bg-muted/40"
        }
      >
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="flex items-center gap-1.5 font-medium">
              {hasFailures ? (
                <AlertTriangle className="size-3.5 text-rose-600 dark:text-rose-400" />
              ) : (
                <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              )}
              直近のスカウト
            </span>
            <span className="font-mono tabular-nums">
              {formatJst(run.startedAt)} JST
            </span>
            <span className="text-muted-foreground tabular-nums">
              ({formatDistanceToNow(run.startedAt, { addSuffix: true, locale: ja })})
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums">
              <span className="font-medium">{run.feedCount}</span>{" "}
              <span className="text-muted-foreground">ソース</span>
            </span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">生</span>{" "}
              <span className="font-medium">{run.rawItemCount}</span>
            </span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">物理</span>{" "}
              <span className="font-medium">{run.physicalCount}</span>
            </span>
            <span className="tabular-nums text-muted-foreground">
              重複 −{run.dedupDroppedCount}
            </span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">評価</span>{" "}
              <span className="font-medium">{run.scoredCount}</span>
            </span>
            <span className="tabular-nums">
              <span className="text-muted-foreground">Inbox</span>{" "}
              <span
                className={
                  run.enqueuedCount > 0
                    ? "font-semibold text-emerald-600 dark:text-emerald-400"
                    : "font-medium"
                }
              >
                {run.enqueuedCount}
              </span>
            </span>
            {hasFailures ? (
              <span className="text-rose-700 dark:text-rose-300 font-medium">
                ⚠ {failed.map((f) => f.name).join(" / ")} 取得失敗
              </span>
            ) : null}
            <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground transition-colors group-hover:text-foreground">
              詳細
              <ArrowRight className="size-3" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
