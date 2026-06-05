import "./_loadenv";
import { runMinimalScout } from "../src/lib/agents/minimal-scout";
import { closeDb } from "../src/lib/db";

async function main() {
  const result = await runMinimalScout({ triggeredBy: "manual" });

  console.log(
    `minimal scout: feeds=${result.feedCount} overseas=${result.overseasCount} japan=${result.japanCount} filtered=${result.filteredCount} scoring=${result.candidateCount}`
  );
  if (result.scoutRunId) {
    console.log(`scout_runs.id=${result.scoutRunId} duration=${result.durationMs}ms`);
  }
  for (const error of result.errors) {
    console.warn(error);
  }
  for (const item of result.results) {
    console.log(
      `${item.verdict.toUpperCase()} score=${item.score.toFixed(2)} ${item.title}`
    );
  }
  console.log(
    `done: ${result.enqueuedCount}/${result.scoredCount} candidate(s) sent to Inbox`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
