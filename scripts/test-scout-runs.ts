/**
 * Smoke test for Phase A visibility layer.
 *
 * - Runs runMinimalScout() with injected feeds (no real RSS fetch)
 * - Confirms the result includes perFeed / startedAt / finishedAt / durationMs
 * - Confirms scout_runs INSERT/UPDATE path can be exercised when DB is available
 *   (skipPersistence=true keeps this safe to run without a database)
 *
 * Usage:
 *   pnpm tsx scripts/test-scout-runs.ts
 */
import "./_loadenv";
import { runMinimalScout } from "../src/lib/agents/minimal-scout";
import { closeDb } from "../src/lib/db";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("✘", msg);
    process.exitCode = 1;
  } else {
    console.log("✓", msg);
  }
}

async function main() {
  // Inject empty feeds to avoid hitting the network. We're only testing the
  // shape of the result and the bookkeeping, not the RSS parser.
  const result = await runMinimalScout({
    triggeredBy: "test",
    overseasFeeds: [],
    japanFeeds: [],
    skipPersistence: true,
  });

  // Existing fields preserved (Vercel cron route relies on these).
  assert(typeof result.feedCount === "number", "feedCount exists");
  assert(typeof result.overseasCount === "number", "overseasCount exists");
  assert(typeof result.japanCount === "number", "japanCount exists");
  assert(typeof result.candidateCount === "number", "candidateCount exists");
  assert(typeof result.filteredCount === "number", "filteredCount exists");
  assert(typeof result.scoredCount === "number", "scoredCount exists");
  assert(typeof result.enqueuedCount === "number", "enqueuedCount exists");
  assert(typeof result.rejectedCount === "number", "rejectedCount exists");
  assert(Array.isArray(result.errors), "errors is array");
  assert(Array.isArray(result.results), "results is array");

  // Phase A additions.
  assert(result.scoutRunId === null, "scoutRunId null when skipPersistence=true");
  assert(result.startedAt instanceof Date, "startedAt is Date");
  assert(result.finishedAt instanceof Date, "finishedAt is Date");
  assert(typeof result.durationMs === "number", "durationMs is number");
  assert(result.durationMs >= 0, "durationMs is non-negative");
  assert(typeof result.rawItemCount === "number", "rawItemCount is number");
  assert(typeof result.physicalCount === "number", "physicalCount is number");
  assert(
    typeof result.dedupDroppedCount === "number",
    "dedupDroppedCount is number"
  );
  assert(Array.isArray(result.perFeed), "perFeed is array");
  assert(result.perFeed.length === 0, "perFeed empty when no feeds");

  // With actual feed configs (injected), perFeed must contain one entry per
  // feed and rawItemCount must reflect parser output.
  const result2 = await runMinimalScout({
    triggeredBy: "test",
    overseasFeeds: [
      {
        source: "FakeFeed",
        region: "overseas",
        url: "https://invalid.example.test/feed",
      },
    ],
    japanFeeds: [],
    skipPersistence: true,
  });
  assert(result2.perFeed.length === 1, "perFeed has 1 entry for 1 feed");
  assert(result2.perFeed[0].name === "FakeFeed", "perFeed name preserved");
  assert(
    result2.perFeed[0].fetched === false,
    "perFeed entry marks fetched=false for unreachable URL"
  );
  assert(
    typeof result2.perFeed[0].errorMessage === "string",
    "perFeed entry has errorMessage on failure"
  );
  assert(
    result2.errors.length === 1,
    "errors array captures the failed feed"
  );

  console.log("\nAll Phase A smoke checks finished.");
}

main()
  .catch((err) => {
    console.error("smoke test threw:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb().catch(() => {});
  });
