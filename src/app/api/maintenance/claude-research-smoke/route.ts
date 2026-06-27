import { runClaudeResearchSmoke } from "@/lib/agents/claude-research-smoke";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  return Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
}

function intParam(value: string | null, fallback: number) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const title = url.searchParams.get("title")?.trim() || undefined;
  const description =
    url.searchParams.get("description")?.trim() || undefined;
  const sourceUrl = url.searchParams.get("sourceUrl")?.trim() || undefined;
  const webSearchMaxUses = intParam(url.searchParams.get("maxUses"), 2);

  try {
    const result = await runClaudeResearchSmoke({
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      webSearchMaxUses,
    });

    return Response.json({
      ...result,
      llmProviderEnv: process.env.LLM_PROVIDER ?? null,
      hasAnthropicEnv: Boolean(
        (process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY)?.trim()
      ),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        llmProviderEnv: process.env.LLM_PROVIDER ?? null,
        hasAnthropicEnv: Boolean(
          (process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY)?.trim()
        ),
      },
      { status: 503 }
    );
  }
}
