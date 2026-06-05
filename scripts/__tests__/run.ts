/**
 * Phase B test runner. Runs all *.test.ts files under scripts/__tests__/
 * with the tiny harness in _assert.ts. No vitest, no jest — just `tsx`.
 *
 * Usage:  pnpm tsx scripts/__tests__/run.ts
 */

// Force mock LLM provider and skip real env loading so DB modules don't crash
// when imported transitively. NB: tests that touch the DB must skipPersistence.
process.env.LLM_PROVIDER ??= "mock";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

import { runSuites, type TestSuite } from "./_assert";
import { reddit } from "./sources/reddit.test";
import { hn } from "./sources/hackernews.test";
import { scoring } from "./scout-scoring.test";
import { minimal } from "./minimal-scout.test";

const suites: TestSuite[] = [
  reddit.suite,
  hn.suite,
  scoring.suite,
  minimal.suite,
];

runSuites(suites)
  .then(({ total, failed }) => {
    console.log(`\nResults: ${total - failed}/${total} passed${failed ? `, ${failed} failed` : ""}.`);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
