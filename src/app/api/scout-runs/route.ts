import { getRecentScoutRuns, safe } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scout-runs?limit=30
 * Returns the most recent scout_runs rows (newest first).
 * Phase A visibility layer — read-only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get("limit") ?? "30");
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 200) : 30;

  const rows = await safe(() => getRecentScoutRuns(limit));
  if (rows === null) {
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true, runs: rows });
}
