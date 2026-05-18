import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agents, budgetAlerts, type BudgetAlert } from "../db/schema";
import { getConsumption } from "./consumption";
import { evaluateBudget, isHard, isSoft, type BudgetStatus } from "./evaluator";
import { sendLarkAlert } from "./lark";

export { evaluateBudget } from "./evaluator";
export type { BudgetLevel, BudgetStatus } from "./evaluator";
export { getConsumption } from "./consumption";
export type { Consumption } from "./consumption";
export { buildDailySummary } from "./summary";

export class BudgetExceededError extends Error {
  readonly status: BudgetStatus;
  readonly agentId: string;
  constructor(agentId: string, status: BudgetStatus) {
    const dailyPart =
      status.daily === "hard"
        ? `daily ${status.dailyPct?.toFixed(1)}% of $${status.dailyBudgetUsd}`
        : null;
    const monthlyPart =
      status.monthly === "hard"
        ? `monthly ${status.monthlyPct?.toFixed(1)}% of $${status.monthlyBudgetUsd}`
        : null;
    super(
      `budget_exceeded: ${agentId} — ${[dailyPart, monthlyPart]
        .filter(Boolean)
        .join("; ")}`
    );
    this.name = "BudgetExceededError";
    this.agentId = agentId;
    this.status = status;
  }
}

function jstDateLabel(d: Date = new Date()): string {
  // Process is expected to run with TZ=Asia/Tokyo (shared/conventions.md §9).
  // Local YYYY-MM-DD therefore equals the JST calendar day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function hasBreachOverride(
  agentId: string,
  date: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: budgetAlerts.id })
    .from(budgetAlerts)
    .where(
      and(
        eq(budgetAlerts.agentId, agentId),
        eq(budgetAlerts.alertDate, date),
        eq(budgetAlerts.threshold, "breach")
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Insert a budget_alert row idempotently (one per agent/date/period/threshold)
 * and dispatch the Lark notification on the FIRST successful insert.
 * If the row already exists, returns null without sending again.
 */
async function recordAlertOnce(input: {
  agentId: string;
  alertDate: string;
  period: "daily" | "monthly";
  threshold: "soft" | "hard" | "breach";
  consumedUsd: number;
  budgetUsd: number;
  consumedPct: number;
}): Promise<BudgetAlert | null> {
  try {
    const [row] = await db
      .insert(budgetAlerts)
      .values({
        agentId: input.agentId,
        alertDate: input.alertDate,
        period: input.period,
        threshold: input.threshold,
        consumedUsd: String(input.consumedUsd),
        budgetUsd: String(input.budgetUsd),
        consumedPct: String(input.consumedPct.toFixed(2)),
      })
      .returning();

    const dispatch = await sendLarkAlert(row);
    if (dispatch.ok) {
      const [updated] = await db
        .update(budgetAlerts)
        .set({
          larkSentAt: new Date(),
          larkResponse: (dispatch.body ?? {}) as Record<string, unknown>,
        })
        .where(eq(budgetAlerts.id, row.id))
        .returning();
      return updated;
    }
    const [updated] = await db
      .update(budgetAlerts)
      .set({
        larkResponse: { error: dispatch.error, status: dispatch.status } as Record<
          string,
          unknown
        >,
      })
      .where(eq(budgetAlerts.id, row.id))
      .returning();
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) return null; // already fired today
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "23505";
}

/**
 * Called by runAgent() BEFORE startRun(). Throws BudgetExceededError when the
 * agent has hit its hard limit and there is no breach-override for today.
 * Records a soft alert (idempotent) when the agent crosses the soft threshold.
 */
export async function checkBudget(agentId: string): Promise<BudgetStatus | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      dailyBudgetUsd: agents.dailyBudgetUsd,
      monthlyBudgetUsd: agents.monthlyBudgetUsd,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) return null;
  if (agent.dailyBudgetUsd == null && agent.monthlyBudgetUsd == null) {
    return null; // no budget configured — keep historical behavior
  }

  const consumed = await getConsumption(agentId);
  const status = evaluateBudget(agent, consumed);
  const today = jstDateLabel();

  if (isHard(status)) {
    const override = await hasBreachOverride(agentId, today);
    if (status.daily === "hard" && status.dailyBudgetUsd != null) {
      await recordAlertOnce({
        agentId,
        alertDate: today,
        period: "daily",
        threshold: "hard",
        consumedUsd: consumed.dailyUsd,
        budgetUsd: status.dailyBudgetUsd,
        consumedPct: status.dailyPct ?? 0,
      }).catch((e) => console.error("[budget] failed to record hard alert", e));
    }
    if (status.monthly === "hard" && status.monthlyBudgetUsd != null) {
      await recordAlertOnce({
        agentId,
        alertDate: today,
        period: "monthly",
        threshold: "hard",
        consumedUsd: consumed.monthlyUsd,
        budgetUsd: status.monthlyBudgetUsd,
        consumedPct: status.monthlyPct ?? 0,
      }).catch((e) => console.error("[budget] failed to record hard alert", e));
    }
    if (!override) throw new BudgetExceededError(agentId, status);
  }

  if (isSoft(status)) {
    if (status.daily === "soft" && status.dailyBudgetUsd != null) {
      void recordAlertOnce({
        agentId,
        alertDate: today,
        period: "daily",
        threshold: "soft",
        consumedUsd: consumed.dailyUsd,
        budgetUsd: status.dailyBudgetUsd,
        consumedPct: status.dailyPct ?? 0,
      }).catch((e) => console.error("[budget] failed to record soft alert", e));
    }
    if (status.monthly === "soft" && status.monthlyBudgetUsd != null) {
      void recordAlertOnce({
        agentId,
        alertDate: today,
        period: "monthly",
        threshold: "soft",
        consumedUsd: consumed.monthlyUsd,
        budgetUsd: status.monthlyBudgetUsd,
        consumedPct: status.monthlyPct ?? 0,
      }).catch((e) => console.error("[budget] failed to record soft alert", e));
    }
  }

  return status;
}

/**
 * Operator action from /agents/[id]: skip the hard-limit gate for the rest of
 * the day. Records a breach row (idempotent) and notifies Lark.
 */
export async function overrideBudgetForToday(agentId: string): Promise<BudgetAlert | null> {
  const [agent] = await db
    .select({
      dailyBudgetUsd: agents.dailyBudgetUsd,
      monthlyBudgetUsd: agents.monthlyBudgetUsd,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return null;

  const consumed = await getConsumption(agentId);
  const status = evaluateBudget(agent, consumed);
  const today = jstDateLabel();

  // Prefer the period that is hard; default to daily.
  const period: "daily" | "monthly" =
    status.monthly === "hard" && status.daily !== "hard" ? "monthly" : "daily";
  const consumedUsd = period === "daily" ? consumed.dailyUsd : consumed.monthlyUsd;
  const budgetUsd =
    (period === "daily" ? status.dailyBudgetUsd : status.monthlyBudgetUsd) ?? 0;
  const consumedPct =
    (period === "daily" ? status.dailyPct : status.monthlyPct) ?? 0;

  return recordAlertOnce({
    agentId,
    alertDate: today,
    period,
    threshold: "breach",
    consumedUsd,
    budgetUsd,
    consumedPct,
  });
}
