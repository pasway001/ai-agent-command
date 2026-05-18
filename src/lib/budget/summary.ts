import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, agents, budgetAlerts } from "../db/schema";

function jstDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a plain-text daily cost summary for the previous full day.
 * Intended for `scripts/budget-summary.ts` (cron 09:00 JST).
 */
export async function buildDailySummary(opts?: {
  for?: Date; // defaults to "yesterday" relative to now
  totalMonthlyBudgetUsd?: number; // optional — printed alongside the total
}): Promise<string> {
  const now = opts?.for ?? new Date();
  const targetDayEnd = new Date(now);
  targetDayEnd.setHours(0, 0, 0, 0);
  const targetDayStart = new Date(targetDayEnd);
  targetDayStart.setDate(targetDayStart.getDate() - 1);
  const dateLabel = jstDateString(targetDayStart);

  const rows = await db
    .select({
      agentId: agentRuns.agentId,
      agentName: agents.name,
      systemNo: agents.systemNo,
      runs: sql<number>`count(*)::int`,
      costUsd: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)`,
      failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
      budgetExceeded: sql<number>`count(*) filter (where ${agentRuns.errorMessage} = 'budget_exceeded')::int`,
    })
    .from(agentRuns)
    .leftJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(
      and(
        gte(agentRuns.createdAt, targetDayStart),
        lt(agentRuns.createdAt, targetDayEnd)
      )
    )
    .groupBy(agentRuns.agentId, agents.name, agents.systemNo)
    .orderBy(desc(sql`sum(${agentRuns.costUsd})`));

  const total = rows.reduce((s, r) => s + Number(r.costUsd), 0);
  const totalFailed = rows.reduce((s, r) => s + r.failed, 0);
  const totalBudgetExceeded = rows.reduce(
    (s, r) => s + r.budgetExceeded,
    0
  );

  const alerts = await db
    .select({
      threshold: budgetAlerts.threshold,
      count: sql<number>`count(*)::int`,
    })
    .from(budgetAlerts)
    .where(eq(budgetAlerts.alertDate, dateLabel))
    .groupBy(budgetAlerts.threshold);

  const alertCount = (t: string) =>
    alerts.find((a) => a.threshold === t)?.count ?? 0;

  const lines: string[] = [];
  lines.push(`📊 Daily Cost Summary — ${dateLabel} (JST)`);
  lines.push("");
  if (opts?.totalMonthlyBudgetUsd != null) {
    const pct = (total / opts.totalMonthlyBudgetUsd) * 100;
    lines.push(
      `Total spend yesterday: $${total.toFixed(2)} / $${opts.totalMonthlyBudgetUsd.toFixed(
        2
      )} monthly budget (${pct.toFixed(1)}%)`
    );
  } else {
    lines.push(`Total spend yesterday: $${total.toFixed(2)}`);
  }
  lines.push("");

  if (rows.length === 0) {
    lines.push("No runs yesterday.");
  } else {
    lines.push("Top agents:");
    rows.slice(0, 5).forEach((r, i) => {
      const name = r.agentName ?? r.agentId;
      lines.push(
        `  ${i + 1}. ${name.padEnd(32)}  $${Number(r.costUsd)
          .toFixed(4)
          .padStart(8)}  (${r.runs} runs)`
      );
    });
  }
  lines.push("");
  lines.push(
    `Alerts fired: ${alertCount("soft")} soft, ${alertCount(
      "hard"
    )} hard, ${alertCount("breach")} breach`
  );
  lines.push(
    `Failed runs:  ${totalFailed} total (${totalBudgetExceeded} budget, ${
      totalFailed - totalBudgetExceeded
    } other)`
  );
  lines.push("");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  lines.push(`→ Dashboard: ${appUrl || "/"}cost`);

  return lines.join("\n");
}
