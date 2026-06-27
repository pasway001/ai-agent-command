import "./_loadenv";
import { runClaudeResearchSmoke } from "../src/lib/agents/claude-research-smoke";

function envInt(key: string, fallback: number) {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const result = await runClaudeResearchSmoke({
    title:
      process.env.SMOKE_RESEARCH_TITLE ??
      "Foldable portable espresso maker",
    description:
      process.env.SMOKE_RESEARCH_DESCRIPTION ??
      "A compact travel espresso maker for desk workers, campers, and gift buyers.",
    webSearchMaxUses: envInt("SMOKE_RESEARCH_WEB_SEARCH_MAX_USES", 2),
  });

  console.log("claude research smoke: OK");
  console.log(`provider=${result.provider} model=${result.model}`);
  console.log(
    `tokens_in=${result.usage.tokensIn} tokens_out=${result.usage.tokensOut} web_searches=${result.usage.webSearchRequests ?? 0} cost_usd=${result.usage.costUsd.toFixed(4)}`
  );
  console.log(
    `trend=${result.research.demandTrend} go_no_go=${result.research.goNoGo} confidence=${result.research.confidence}`
  );
  console.log(`summary=${result.research.summary}`);
  console.log(`evidence_count=${result.research.evidenceCount}`);
  if (result.research.firstEvidenceUrl) {
    console.log(`first_evidence_url=${result.research.firstEvidenceUrl}`);
  }
}

main()
  .catch((err) => {
    console.error("claude research smoke: FAILED");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
