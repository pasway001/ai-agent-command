import { bootstrapResearchProducts } from "@/lib/maintenance/bootstrap-research-products";
import { getReadinessReport } from "@/lib/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await bootstrapResearchProducts();
  const readiness = await getReadinessReport({ checkDb: true });

  return Response.json({
    ok: readiness.ok,
    result,
    readiness,
  });
}
