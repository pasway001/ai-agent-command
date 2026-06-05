import { getScoutRunById, safe } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scout-runs/[id]
 * Returns one scout_runs row including the full perFeed breakdown.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: "missing_id" }, { status: 400 });
  }
  const row = await safe(() => getScoutRunById(id));
  if (row === null) {
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!row) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true, run: row });
}
