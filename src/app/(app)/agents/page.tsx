import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/nav/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DbErrorState, EmptyState } from "@/components/empty-state";
import { StatusDot } from "@/components/status-dot";
import { SummaryCard } from "@/components/summary-card";
import { getAgentsWithStats, safe } from "@/lib/db/queries";
import { cn, systemHue, systemLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const list = await safe(() => getAgentsWithStats());

  const fmtPct = (v: number | null) =>
    v === null ? (
      <span className="text-muted-foreground/40">—</span>
    ) : (
      `${Math.round(v * 100)}%`
    );
  const fmtMs = (v: number | null) =>
    v === null ? (
      <span className="text-muted-foreground/40">—</span>
    ) : v < 1000 ? (
      `${Math.round(v)}ms`
    ) : (
      `${(v / 1000).toFixed(1)}s`
    );
  const agreementColor = (v: number | null) =>
    v === null
      ? "text-muted-foreground/40"
      : v >= 0.8
        ? "text-emerald-600 dark:text-emerald-400"
        : v >= 0.6
          ? "text-amber-600 dark:text-amber-500"
          : "text-rose-600 dark:text-rose-400";

  const activeCount = list?.filter((a) => a.runs24h > 0).length ?? 0;
  const failingCount = list?.filter((a) => a.failures24h > 0).length ?? 0;
  const reviewedSum = list?.reduce((s, a) => s + a.reviewed30d, 0) ?? 0;
  const weightedAgreement = list
    ? list.reduce(
        (s, a) =>
          s + (a.agreement30d !== null ? a.agreement30d * a.reviewed30d : 0),
        0
      )
    : 0;
  const avgAgreement = reviewedSum > 0 ? weightedAgreement / reviewedSum : null;

  return (
    <>
      <PageHeader
        title="エージェント稼働状況"
        description="直近24時間の稼働と直近30日の品質メトリクス。一致率は ≥80% 緑 / 60–80% 黄 / <60% 赤。"
        action={
          <Button nativeButton={false} render={<Link href="/agents/new" />}>
            <Plus />
            新規エージェント
          </Button>
        }
      />
      <div className="flex-1 px-4 sm:px-6 lg:px-8 py-6">
        {list === null ? (
          <DbErrorState />
        ) : list.length === 0 ? (
          <EmptyState
            title="エージェントが未登録です"
            description="`pnpm db:seed` を実行して初期エージェントを投入してください。"
          />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <SummaryCard label="登録エージェント" value={list.length} />
              <SummaryCard
                label="稼働中 (24h)"
                value={activeCount}
                accent={activeCount > 0 ? "emerald" : "muted"}
              />
              <SummaryCard
                label="失敗あり (24h)"
                value={failingCount}
                accent={failingCount > 0 ? "rose" : "muted"}
              />
              <SummaryCard
                label="平均一致率 (30d)"
                value={
                  avgAgreement !== null
                    ? `${Math.round(avgAgreement * 100)}%`
                    : "—"
                }
                hint={
                  avgAgreement !== null ? `n=${reviewedSum}` : "判断付き run なし"
                }
                accent={avgAgreement === null ? "muted" : "default"}
              />
            </div>

            <div className="rounded-md border overflow-x-auto bg-card">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>エージェント</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead className="text-right">同時</TableHead>
                    <TableHead className="text-right">24h 実行</TableHead>
                    <TableHead className="text-right">24h 失敗</TableHead>
                    <TableHead className="text-right">30d 一致率</TableHead>
                    <TableHead className="text-right">30d 人却下</TableHead>
                    <TableHead className="text-right">平均応答</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => {
                    const dim = a.runs24h === 0;
                    const danger = a.failures24h > 0;
                    return (
                      <TableRow
                        key={a.id}
                        className={cn(
                          "transition-colors hover:bg-muted/40",
                          dim && "opacity-65",
                          danger &&
                            "bg-rose-50/40 hover:bg-rose-50/60 dark:bg-rose-500/[0.04] dark:hover:bg-rose-500/[0.07]"
                        )}
                      >
                        <TableCell className="py-3.5 relative">
                          <span
                            aria-hidden
                            className={cn(
                              "absolute left-0 top-2 bottom-2 w-0.5 rounded-r",
                              systemHue(a.systemNo)
                            )}
                          />
                          <Link
                            href={`/agents/${encodeURIComponent(a.id)}`}
                            className="block hover:underline pl-3"
                          >
                            <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                              {systemLabel(a.systemNo)}
                            </div>
                            <div className="font-medium text-sm">{a.name}</div>
                            <div className="font-mono text-xs text-muted-foreground/70">
                              {a.id}
                            </div>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <StatusDot
                            active={a.enabled}
                            label={a.enabled ? "有効" : "無効"}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.concurrencyLimit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.runs24h > 0 ? (
                            <span className="font-medium">{a.runs24h}</span>
                          ) : (
                            <span className="text-muted-foreground/40">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.failures24h > 0 ? (
                            <span className="text-rose-600 dark:text-rose-400 font-medium">
                              {a.failures24h}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">0</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums font-medium",
                            agreementColor(a.agreement30d)
                          )}
                          title={
                            a.reviewed30d > 0
                              ? `n=${a.reviewed30d}`
                              : "人間判断付き run なし"
                          }
                        >
                          {fmtPct(a.agreement30d)}
                          {a.reviewed30d > 0 ? (
                            <span
                              className={cn(
                                "ml-1 text-[10px] font-normal",
                                a.reviewed30d < 3
                                  ? "text-amber-600 dark:text-amber-500"
                                  : "text-muted-foreground"
                              )}
                              title={
                                a.reviewed30d < 3
                                  ? "サンプル数が少なく信頼性が低い"
                                  : undefined
                              }
                            >
                              n={a.reviewed30d}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPct(a.humanRejectRate30d)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {fmtMs(a.avgLatencyMs30d)}
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
