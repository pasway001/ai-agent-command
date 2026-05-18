import type { Agent } from "../db/schema";
import type { Consumption } from "./consumption";

export type BudgetLevel = "ok" | "soft" | "hard";

export type BudgetStatus = {
  daily: BudgetLevel;
  monthly: BudgetLevel;
  dailyPct: number | null;
  monthlyPct: number | null;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  consumed: Consumption;
};

function pct(consumed: number, budget: number | null): number | null {
  if (budget == null || budget <= 0) return null;
  return (consumed / budget) * 100;
}

function level(p: number | null, softPct: number, hardPct: number): BudgetLevel {
  if (p == null) return "ok";
  if (p >= hardPct) return "hard";
  if (p >= softPct) return "soft";
  return "ok";
}

const SOFT_DEFAULT = 80;
const HARD_DEFAULT = 100;

function readThreshold(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function evaluateBudget(
  agent: Pick<Agent, "dailyBudgetUsd" | "monthlyBudgetUsd">,
  consumed: Consumption
): BudgetStatus {
  const softPct = readThreshold("BUDGET_SOFT_THRESHOLD_PCT", SOFT_DEFAULT);
  const hardPct = readThreshold("BUDGET_HARD_THRESHOLD_PCT", HARD_DEFAULT);

  const dailyBudget =
    agent.dailyBudgetUsd != null ? Number(agent.dailyBudgetUsd) : null;
  const monthlyBudget =
    agent.monthlyBudgetUsd != null ? Number(agent.monthlyBudgetUsd) : null;

  const dailyPct = pct(consumed.dailyUsd, dailyBudget);
  const monthlyPct = pct(consumed.monthlyUsd, monthlyBudget);

  return {
    daily: level(dailyPct, softPct, hardPct),
    monthly: level(monthlyPct, softPct, hardPct),
    dailyPct,
    monthlyPct,
    dailyBudgetUsd: dailyBudget,
    monthlyBudgetUsd: monthlyBudget,
    consumed,
  };
}

export function isHard(status: BudgetStatus): boolean {
  return status.daily === "hard" || status.monthly === "hard";
}

export function isSoft(status: BudgetStatus): boolean {
  return status.daily === "soft" || status.monthly === "soft";
}
