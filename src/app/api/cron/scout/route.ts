import { runMinimalScout } from "@/lib/agents/minimal-scout";
import { sendScoutResultAlert } from "@/lib/lark-scout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function positiveIntFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key] ?? "");
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runMinimalScout({
    triggeredBy: "cron",
    limitPerFeed: positiveIntFromEnv("SCOUT_CRON_LIMIT_PER_FEED", 20),
    llmMax: positiveIntFromEnv("SCOUT_CRON_LLM_MAX", 8),
  });

  try {
    await sendScoutResultAlert(result);
  } catch (err) {
    console.error("[cron/scout] Lark notification failed", err);
  }

  return Response.json({
    ok: true,
    ...result,
  });
}
