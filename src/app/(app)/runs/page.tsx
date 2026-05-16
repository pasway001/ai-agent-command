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
import { DbErrorState, EmptyState } from "@/components/empty-state";
import { RunStatusBadge } from "@/components/status-badge";
import { getRecentRuns, safe } from "@/lib/db/queries";
import { formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await safe(() => getRecentRuns(100));

  return (
    <>
      <PageHeader
        title="実行ログ・根拠"
        description="直近の実行 (最新100件)"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {runs === null ? (
          <DbErrorState />
        ) : runs.length === 0 ? (
          <EmptyState title="まだ実行ログはありません" />
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {runs.length} 件
              </p>
            </div>
            <div className="rounded-md border overflow-x-auto bg-card">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>状態</TableHead>
                    <TableHead>エージェント</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead className="text-right">tokens (in/out)</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">経過</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow
                      key={r.id}
                      className="hover:bg-muted/40 transition-colors"
                    >
                      <TableCell>
                        <RunStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.agentId}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {r.productTitle ?? (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-xs">
                        {r.tokensIn} / {r.tokensOut}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-xs">
                        {Number(r.costUsd) === 0 ? (
                          <span className="text-muted-foreground/40">
                            {formatUsd(0)}
                          </span>
                        ) : (
                          formatUsd(r.costUsd)
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {r.startedAt
                          ? formatDistanceToNow(r.startedAt, {
                              addSuffix: true,
                              locale: ja,
                            })
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
