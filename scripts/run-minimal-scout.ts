import "./_loadenv";
import { runMinimalScout } from "../src/lib/agents/minimal-scout";

async function main() {
  const result = await runMinimalScout();

  console.log(
    `minimal scout: feeds=${result.feedCount} overseas=${result.overseasCount} japan=${result.japanCount} scoring=${result.candidateCount}`
  );
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
