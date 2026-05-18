import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import { agentRuns } from "../db/schema";

export type Consumption = {
  dailyUsd: number;
  monthlyUsd: number;
  dailyRuns: number;
  monthlyRuns: number;
};

/**
 * Day/month boundaries in the process timezone. The deployment sets TZ=Asia/Tokyo
 * (per shared/conventions.md §9), so `new Date()` at midnight gives the JST day
 * boundary on the Mac mini host. If TZ is not set, boundaries fall back to the
 * server's local time.
 */
function dayStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function getConsumption(agentId: string): Promise<Consumption> {
  const now = new Date();
  const dayCutoff = dayStart(now);
  const monthCutoff = monthStart(now);

  const [row] = await db
    .select({
      monthlyUsd: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)`,
      monthlyRuns: sql<number>`count(*)::int`,
      dailyUsd: sql<string>`coalesce(sum(case when ${agentRuns.createdAt} >= ${dayCutoff.toISOString()} then ${agentRuns.costUsd} else 0 end), 0)`,
      dailyRuns: sql<number>`count(*) filter (where ${agentRuns.createdAt} >= ${dayCutoff.toISOString()})::int`,
    })
    .from(agentRuns)
    .where(
      and(eq(agentRuns.agentId, agentId), gte(agentRuns.createdAt, monthCutoff))
    );

  return {
    dailyUsd: Number(row?.dailyUsd ?? 0),
    monthlyUsd: Number(row?.monthlyUsd ?? 0),
    dailyRuns: Number(row?.dailyRuns ?? 0),
    monthlyRuns: Number(row?.monthlyRuns ?? 0),
  };
}
