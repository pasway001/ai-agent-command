import "./_loadenv";
import { buildDailySummary } from "../src/lib/budget/summary";
import { agents } from "../src/lib/db/schema";
import { db } from "../src/lib/db";

/**
 * Daily cost summary. Suggested cron: 09:00 JST.
 *
 *   pnpm tsx scripts/budget-summary.ts            # print to stdout + send to Lark
 *   pnpm tsx scripts/budget-summary.ts --dry-run  # print only
 *
 * Lark posting reuses src/lib/budget/lark.ts (text-card variant) so that the
 * unset webhook just dumps to console — same dev/prod ergonomics as alerts.
 */

async function totalMonthlyBudget(): Promise<number> {
  const rows = await db
    .select({ monthlyBudgetUsd: agents.monthlyBudgetUsd })
    .from(agents);
  return rows.reduce(
    (s, r) => s + (r.monthlyBudgetUsd != null ? Number(r.monthlyBudgetUsd) : 0),
    0
  );
}

async function postToLark(text: string): Promise<void> {
  const webhook = process.env.LARK_WEBHOOK_URL_OPS;
  if (!webhook) {
    console.log("[budget-summary] LARK_WEBHOOK_URL_OPS not set — skipping Lark post");
    return;
  }
  const timeoutMs = Number(process.env.LARK_WEBHOOK_TIMEOUT_MS ?? "5000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
      signal: controller.signal,
    });
    console.log(`[budget-summary] Lark response status=${res.status}`);
  } catch (err) {
    console.error("[budget-summary] Lark post failed:", (err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const totalBudget = await totalMonthlyBudget();
  const text = await buildDailySummary({
    totalMonthlyBudgetUsd: totalBudget || undefined,
  });
  console.log(text);
  if (!dryRun) await postToLark(text);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
