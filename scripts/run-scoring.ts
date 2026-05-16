import "./_loadenv";
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import {
  scoreCandidate,
  type CandidateSignals,
} from "../src/lib/agents/scout-scoring";

async function main() {
  const arg = process.argv[2] ?? "scripts/sample-candidates.json";
  const path = isAbsolute(arg) ? arg : join(process.cwd(), arg);
  const raw = await readFile(path, "utf8");
  const candidates = JSON.parse(raw) as CandidateSignals[];

  console.log(`▶ scout.scoring on ${candidates.length} candidates from ${arg}`);

  let approved = 0;
  let escalated = 0;
  let rejected = 0;

  for (const c of candidates) {
    const r = await scoreCandidate(c);
    const tag =
      r.output.verdict === "approve"
        ? "✓ APPROVE"
        : r.output.verdict === "reject"
          ? "✗ REJECT "
          : "⚠ ESCALATE";
    console.log(
      `  ${tag} score=${r.output.score.toFixed(2)} prio=${r.output.suggestedPriority} ${c.title}`
    );
    if (r.output.verdict === "approve") approved++;
    else if (r.output.verdict === "reject") rejected++;
    else escalated++;
  }

  console.log(
    `✔ done — approve:${approved} escalate:${escalated} reject:${rejected}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
