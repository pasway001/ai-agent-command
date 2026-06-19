import { closeDb } from "@/lib/db";
import { getReadinessReport } from "@/lib/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const checkDb = url.searchParams.get("db") === "1";
  const report = await getReadinessReport({ checkDb });
  if (checkDb) await closeDb();

  return Response.json(report, { status: report.ok ? 200 : 503 });
}
