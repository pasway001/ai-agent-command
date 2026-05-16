import "./_loadenv";
import {
  startRun,
  finishRun,
  failRun,
  recordAutoEvaluation,
  enqueueApproval,
  upsertProduct,
} from "../src/lib/agent-sdk";

type Scenario = {
  agentId: string;
  product: { title: string; asin?: string; jan?: string };
  enqueue: boolean;
  priority?: number;
  fail?: boolean;
  reasoning?: string;
  score?: number;
};

const SCENARIOS: Record<string, Scenario> = {
  scoring: {
    agentId: "scout.scoring",
    product: {
      title: "[scout] 高吸収マグネシウムサプリ 60粒",
      asin: "B0DEMO0001",
    },
    enqueue: true,
    priority: 5,
    score: 0.83,
    reasoning:
      "Keepa BSR上位20%、月間売上推定¥3.2M、競合5。利益率24%確保見込み。",
  },
  perplexity: {
    agentId: "scout.perplexity_jp_market",
    product: {
      title: "[scout] 国産プロテインバー(ホエイ20g)",
      asin: "B0DEMO0002",
    },
    enqueue: true,
    priority: 2,
    score: 0.61,
    reasoning:
      "国内検索ボリューム上昇傾向。規制リスク低。先行ブランド3社あり差別化要検討。",
  },
  fail: {
    agentId: "scout.keepa_monitor",
    product: { title: "[scout] 失敗ケース", asin: "B0DEMOFAIL" },
    enqueue: false,
    fail: true,
    reasoning: "Keepa API rate limited",
  },
};

async function run(scenarioKey: string) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(
      `Unknown scenario: ${scenarioKey}. Available: ${Object.keys(SCENARIOS).join(", ")}`
    );
    process.exit(1);
  }

  console.log(`▶ Running scenario "${scenarioKey}" (agent=${scenario.agentId})`);

  const product = await upsertProduct({
    title: scenario.product.title,
    asin: scenario.product.asin,
    jan: scenario.product.jan,
    sourceAgentId: scenario.agentId,
    stage: "scout",
    status: "pending",
    metadata: { simulated: true },
  });
  console.log(`  ✔ product upserted: ${product.id}`);

  const run = await startRun({
    agentId: scenario.agentId,
    productId: product.id,
    inputPayload: { simulated: true, scenario: scenarioKey },
  });
  console.log(`  ✔ run started: ${run.id}`);

  // Simulate work
  await new Promise((r) => setTimeout(r, 400));

  if (scenario.fail) {
    await failRun({
      runId: run.id,
      agentId: scenario.agentId,
      errorMessage: scenario.reasoning ?? "simulated failure",
    });
    console.log("  ✖ run marked failed");
    return;
  }

  await finishRun({
    runId: run.id,
    agentId: scenario.agentId,
    outputPayload: {
      score: scenario.score,
      reasoning: scenario.reasoning,
    },
    tokensIn: 1200,
    tokensOut: 480,
    costUsd: 0.012,
  });
  console.log("  ✔ run succeeded");

  await recordAutoEvaluation({
    runId: run.id,
    productId: product.id,
    verdict: "escalate",
    score: scenario.score,
    reasoning: scenario.reasoning,
  });
  console.log("  ✔ auto evaluation recorded");

  if (scenario.enqueue) {
    const item = await enqueueApproval({
      runId: run.id,
      productId: product.id,
      priority: scenario.priority ?? 0,
      requiredRole: "reviewer",
    });
    console.log(`  ✔ enqueued for review: ${item.id}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const keys = args.length > 0 ? args : ["scoring", "perplexity", "fail"];
  for (const k of keys) {
    await run(k);
  }
  console.log("✔ done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
