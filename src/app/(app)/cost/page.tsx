import { PageHeader } from "@/components/nav/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DbErrorState, EmptyState } from "@/components/empty-state";
import { SummaryCard } from "@/components/summary-card";
import {
  getCostSummary,
  getTodayBudgetAlertCount,
  safe,
} from "@/lib/db/queries";
import { cn, formatNum, formatUsd, systemHue, systemLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

function BudgetBar({
  pct,
  consumedUsd,
  budgetUsd,
}: {
  pct: number | null;
  consumedUsd: number;
  budgetUsd: number | null;
}) {
  if (budgetUsd == null) {
    return (
      <span className="text-[10px] text-muted-foreground/40">no budget</span>
    );
  }
  const value = Math.max(0, pct ?? 0);
  const clamped = Math.min(100, value);
  const color =
    value >= 100
      ? "bg-red-500"
      : value >= 80
        ? "bg-amber-500"
        : "bg-emerald-500";
  const remaining = Math.max(0, budgetUsd - consumedUsd);
  return (
    <div className="flex flex-col items-end gap-0.5 w-32">
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full transition-all", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {value.toFixed(0)}% · 残り{formatUsd(remaining)}
      </div>
    </div>
  );
}

export default async function CostPage() {
  const [rows, alerts] = await Promise.all([
    safe(() => getCostSummary()),
    safe(() => getTodayBudgetAlertCount()),
  ]);

  const totalToday = rows?.reduce((s, r) => s + Number(r.todayUsd), 0) ?? 0;
  const totalMonth = rows?.reduce((s, r) => s + Number(r.monthUsd), 0) ?? 0;
  const totalRuns = rows?.reduce((s, r) => s + r.totalRuns, 0) ?? 0;
  const totalTokens =
    rows?.reduce(
      (s, r) => s + Number(r.tokensInMonth) + Number(r.tokensOutMonth),
      0
    ) ?? 0;

  // Group rows by systemNo for system-level subtotals.
  const bySystem = new Map<
    number,
    {
      systemNo: number;
      monthUsd: number;
      runs: number;
      tokens: number;
    }
  >();
  for (const r of rows ?? []) {
    const cur =
      bySystem.get(r.systemNo) ??
      { systemNo: r.systemNo, monthUsd: 0, runs: 0, tokens: 0 };
    cur.monthUsd += Number(r.monthUsd);
    cur.runs += r.totalRuns;
    cur.tokens += Number(r.tokensInMonth) + Number(r.tokensOutMonth);
    bySystem.set(r.systemNo, cur);
  }
  const systemRows = Array.from(bySystem.values()).sort(
    (a, b) => a.systemNo - b.systemNo
  );

  return (
    <>
      <PageHeader
        title="コスト"
        description="エージェント別の API 利用コスト (Anthropic API 課金推計)"
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {rows === null ? (
          <DbErrorState />
        ) : (
          <>
            {alerts && (alerts.soft || alerts.hard || alerts.breach) ? (
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="font-medium text-muted-foreground">
                  本日のアラート:
                </span>
                {alerts.hard > 0 && (
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
                    🚨 hard {alerts.hard}
                  </Badge>
                )}
                {alerts.soft > 0 && (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                    ⚠️ soft {alerts.soft}
                  </Badge>
                )}
                {alerts.breach > 0 && (
                  <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30">
                    🟣 breach {alerts.breach}
                  </Badge>
                )}
              </div>
            ) : null}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard label="本日" value={formatUsd(totalToday)} />
              <SummaryCard label="今月累計" value={formatUsd(totalMonth)} />
              <SummaryCard
                label="今月 実行回数"
                value={formatNum(totalRuns)}
              />
              <SummaryCard
                label="今月 トークン"
                value={formatNum(totalTokens)}
              />
            </div>

            {systemRows.length > 0 ? (
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  System 別 今月サマリ
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {systemRows.map((s) => (
                    <Card key={s.systemNo} className="py-0 overflow-hidden">
                      <CardHeader className="pb-1 px-4 pt-3 relative">
                        <span
                          aria-hidden
                          className={cn(
                            "absolute left-0 top-0 bottom-0 w-0.5",
                            systemHue(s.systemNo)
                          )}
                        />
                        <CardTitle className="text-xs font-medium text-muted-foreground">
                          {systemLabel(s.systemNo)}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-4 pb-4">
                        <div className="text-xl font-bold tabular-nums">
                          {formatUsd(s.monthUsd)}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                          {formatNum(s.runs)} runs ·{" "}
                          {formatNum(s.tokens)} tok
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <EmptyState title="今月の実行はまだありません" />
            ) : (
              <div className="rounded-md border overflow-x-auto bg-card">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>System</TableHead>
                      <TableHead>エージェント</TableHead>
                      <TableHead className="text-right">本日</TableHead>
                      <TableHead className="text-right">今月</TableHead>
                      <TableHead className="text-right">日次予算</TableHead>
                      <TableHead className="text-right">月次予算</TableHead>
                      <TableHead className="text-right">実行</TableHead>
                      <TableHead className="text-right">in tok</TableHead>
                      <TableHead className="text-right">out tok</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.agentId}
                        className="hover:bg-muted/40 transition-colors"
                      >
                        <TableCell className="relative py-3.5">
                          <span
                            aria-hidden
                            className={cn(
                              "absolute left-0 top-2 bottom-2 w-0.5 rounded-r",
                              systemHue(r.systemNo)
                            )}
                          />
                          <Badge variant="outline" className="ml-2">
                            {systemLabel(r.systemNo)}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.agentId}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {Number(r.todayUsd) === 0 ? (
                            <span className="text-muted-foreground/40">
                              {formatUsd(0)}
                            </span>
                          ) : (
                            formatUsd(r.todayUsd)
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-xs">
                          {Number(r.monthUsd) === 0 ? (
                            <span className="text-muted-foreground/40">
                              {formatUsd(0)}
                            </span>
                          ) : (
                            formatUsd(r.monthUsd)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <BudgetBar
                              pct={r.dailyPct}
                              consumedUsd={Number(r.todayUsd)}
                              budgetUsd={r.dailyBudgetUsd}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end">
                            <BudgetBar
                              pct={r.monthlyPct}
                              consumedUsd={Number(r.monthUsd)}
                              budgetUsd={r.monthlyBudgetUsd}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.totalRuns}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatNum(r.tokensInMonth)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          {formatNum(r.tokensOutMonth)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
