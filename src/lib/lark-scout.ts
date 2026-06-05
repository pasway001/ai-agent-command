export type ScoutRunResult = {
  scoredCount: number;
  approvedCount?: number;
  totalCostUsd?: number;
  topProducts?: Array<{ title: string; score?: number }>;
  durationMs?: number;
};

export type ScoutAlertDispatchResult = {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
};

export function buildScoutResultCard(result: ScoutRunResult): Record<string, unknown> {
  const approvedCount = result.approvedCount ?? 0;
  const scoredCount = result.scoredCount;

  let headerColor: string;
  let headerTitle: string;

  if (approvedCount > 0) {
    headerColor = "green";
    headerTitle = `✅ Scout 完了 — ${approvedCount} 件承認`;
  } else if (scoredCount > 0) {
    headerColor = "yellow";
    headerTitle = `⚠️ Scout 完了 — スコア済 ${scoredCount} 件 / 承認なし`;
  } else {
    headerColor = "blue";
    headerTitle = `ℹ️ Scout 完了 — 新着なし`;
  }

  const dashboardBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const inboxLink = dashboardBase
    ? `${dashboardBase.replace(/\/$/, "")}/inbox`
    : "/inbox";

  const lines: string[] = [
    `**スコア済**: ${scoredCount} 件`,
    `**承認 (score ≥ 70)**: ${approvedCount} 件`,
  ];

  if (result.totalCostUsd !== undefined) {
    lines.push(`**API コスト**: $${result.totalCostUsd.toFixed(4)}`);
  }

  if (result.durationMs !== undefined) {
    lines.push(`**所要時間**: ${(result.durationMs / 1000).toFixed(1)} 秒`);
  }

  if (result.topProducts && result.topProducts.length > 0) {
    lines.push("");
    lines.push("**Top 商品**");
    result.topProducts.slice(0, 3).forEach((p, i) => {
      const scoreText = p.score !== undefined ? ` (score: ${p.score})` : "";
      lines.push(`${i + 1}. ${p.title}${scoreText}`);
    });
  }

  lines.push("");
  lines.push(`[📥 Inbox を開く](${inboxLink})`);

  return {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: headerTitle },
        template: headerColor,
      },
      elements: [
        {
          tag: "markdown",
          content: lines.join("\n"),
        },
      ],
    },
  };
}

/**
 * Post scout run results as an interactive card to Lark.
 * Never throws — falls back to console.log when LARK_WEBHOOK_URL_OPS is unset.
 */
export async function sendScoutResultAlert(
  result: ScoutRunResult
): Promise<ScoutAlertDispatchResult> {
  const webhook = process.env.LARK_WEBHOOK_URL_OPS;
  const card = buildScoutResultCard(result);

  if (!webhook) {
    console.log(
      "[lark-scout] LARK_WEBHOOK_URL_OPS not set — dumping payload",
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
