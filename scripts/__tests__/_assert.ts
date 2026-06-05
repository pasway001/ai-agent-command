/**
 * Tiny stdlib-free test harness. We avoid pulling in vitest/jest just for a
 * dozen tests; tsx runs straight from `pnpm tsx scripts/__tests__/run.ts`.
 */

export type TestResult = {
  name: string;
  passed: boolean;
  error?: string;
};

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, msg = ""): void {
  if (actual !== expected) {
    throw new Error(
      `assertEqual${msg ? ` (${msg})` : ""}: expected ${JSON.stringify(
        expected
      )} got ${JSON.stringify(actual)}`
    );
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, msg = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      `assertDeepEqual${msg ? ` (${msg})` : ""}: expected ${b}, got ${a}`
    );
  }
}

export type TestSuite = {
  name: string;
  tests: Array<{ name: string; fn: () => void | Promise<void> }>;
};

export function defineSuite(name: string): {
  test: (name: string, fn: () => void | Promise<void>) => void;
  suite: TestSuite;
} {
  const suite: TestSuite = { name, tests: [] };
  return {
    suite,
    test: (n, fn) => suite.tests.push({ name: n, fn }),
  };
}

export async function runSuites(suites: TestSuite[]): Promise<{
  total: number;
  failed: number;
}> {
  let total = 0;
  let failed = 0;
  for (const s of suites) {
    console.log(`\n${DIM}─ ${s.name}${RESET}`);
    for (const t of s.tests) {
      total++;
      try {
        await t.fn();
        console.log(`  ${GREEN}✓${RESET} ${t.name}`);
      } catch (err) {
        failed++;
        console.log(
          `  ${RED}✗${RESET} ${t.name}\n    ${RED}${(err as Error).message}${RESET}`
        );
      }
    }
  }
  return { total, failed };
}
