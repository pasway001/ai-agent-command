import "./_loadenv";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { runKeepaMonitor } from "../src/lib/agents/scout-keepa";
import { runSellerspriteResearch } from "../src/lib/agents/scout-sellersprite";
import { runPerplexityResearch } from "../src/lib/agents/scout-perplexity";
import { scoreExistingProduct } from "../src/lib/agents/scout-scoring";
import type { WatchlistItem } from "../src/lib/agents/scout-keepa";

async function main() {
  const arg = process.argv[2] ?? "scripts/sample-watchlist.json";
  const path = isAbsolute(arg) ? arg : join(process.cwd(), arg);
  const watchlist = JSON.parse(await readFile(path, "utf8")) as WatchlistItem[];

  console.log(`▶ pipeline demo on ${watchlist.length} items`);

  console.log("\n[1/4] scout.keepa_monitor");
  const keepaResults = await runKeepaMonitor(watchlist);
  for (const r of keepaResults) {
    console.log(
      `  ✔ ${r.product.asin} BSR=${r.outcome.data.bsr} ¥${r.outcome.data.priceJpy}`
    );
  }

  console.log("\n[2/4] scout.sellersprite_research");
  const ssResults = await runSellerspriteResearch(watchlist);
  for (const r of ssResults) {
    console.log(
      `  ✔ ${r.product.asin} 月商¥${r.outcome.data.monthlySalesJpy.toLocaleString()} 競合${r.outcome.data.competitorCount}社`
    );
  }

  console.log("\n[3/4] scout.perplexity_jp_market");
  const pxResults = await runPerplexityResearch(watchlist);
  for (const r of pxResults) {
    console.log(
      `  ✔ ${r.product.asin} trend=${r.outcome.data.domesticDemandTrend} risk=${r.outcome.data.regulatoryRisk}`
    );
  }

  console.log("\n[4/4] scout.scoring (集約スコアリング)");
  let approve = 0;
  let escalate = 0;
  let reject = 0;
  for (const r of keepaResults) {
    const result = await scoreExistingProduct(r.product.id);
    const tag =
      result.output.verdict === "approve"
        ? "✓ APPROVE  "
        : result.output.verdict === "reject"
          ? "✗ REJECT   "
          : "⚠ ESCALATE ";
    console.log(
      `  ${tag} score=${result.output.score.toFixed(2)} ${r.product.title}`
    );
    if (result.output.verdict === "approve") approve++;
    else if (result.output.verdict === "reject") reject++;
    else escalate++;
  }

  console.log(
    `\n✔ done — approve:${approve} escalate:${escalate} reject:${reject}`
  );
  console.log(
    "  Inboxを開いて承認すると lp.copy_writer/compliance/faq/image が自動で動き、"
  );
  console.log(
    "  続けて ad → outreach → cs と段階を進められます。"
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
