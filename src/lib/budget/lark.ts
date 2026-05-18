import type { BudgetAlert } from "../db/schema";

export type AlertDispatchResult = {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
};

const HEADER_COLORS = {
  soft: "yellow",
  hard: "red",
  breach: "purple",
} as const;

const HEADER_PREFIX = {
  soft: "⚠️ Budget Soft Alert",
  hard: "🚨 Budget HARD LIMIT",
  breach: "🟣 Budget Override",
} as const;

type Threshold = keyof typeof HEADER_PREFIX;

export function buildLarkCard(alert: BudgetAlert): Record<string, unknown> {
  const threshold = alert.threshold as Threshold;
  const headerPrefix = HEADER_PREFIX[threshold] ?? "Budget Alert";
  const color = HEADER_COLORS[threshold] ?? "blue";
  const stoppedNote =
    threshold === "hard" ? "  (実行停止中)" : threshold === "breach" ? "  (手動上書き)" : "";

  const title = `${headerPrefix} — ${alert.agentId} ${alert.period} ${Number(
    alert.consumedPct
  ).toFixed(1)}%${stoppedNote}`;

  const dashboardBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const dashboardLink = dashboardBase
    ? `${dashboardBase.replace(/\/$/, "")}/cost?agent=${encodeURIComponent(
        alert.agentId
      )}`
    : `/cost?agent=${encodeURIComponent(alert.agentId)}`;

  const body = [
    `**Agent**: \`${alert.agentId}\``,
    `**Period**: ${alert.period}`,
    `**Consumed**: $${Number(alert.consumedUsd).toFixed(4)} / $${Number(
      alert.budgetUsd
    ).toFixed(2)}  (${Number(alert.consumedPct).toFixed(1)}%)`,
    `**Date (JST)**: ${alert.alertDate}`,
    "",
    `[📊 ダッシュボード](${dashboardLink})`,
  ].join("\n");

  return {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: title },
        template: color,
      },
      elements: [
        {
          tag: "markdown",
          content: body,
        },
      ],
    },
  };
}

/**
 * Post an interactive card to Lark. Failures never throw — they are returned
 * for the caller to record on budget_alerts.lark_response and surface in /cost.
 * Falls back to console.log when LARK_WEBHOOK_URL_OPS is unset (dev / CI).
 */
export async function sendLarkAlert(
  alert: BudgetAlert
): Promise<AlertDispatchResult> {
  const webhook = process.env.LARK_WEBHOOK_URL_OPS;
  const card = buildLarkCard(alert);

  if (!webhook) {
    console.log(
      "[budget.lark] LARK_WEBHOOK_URL_OPS not set — dumping payload",
      JSON.stringify(card, null, 2)
    );
    return { ok: true, status: 0, body: { mocked: true } };
  }

  const timeoutMs = Number(process.env.LARK_WEBHOOK_TIMEOUT_MS ?? "5000");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card),
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // body is not JSON; keep as text
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
