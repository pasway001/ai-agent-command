import "./_loadenv";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { count, desc, isNull } from "drizzle-orm";
import { closeDb, db } from "../src/lib/db";
import { agents, approvalQueue, products, scoutRuns } from "../src/lib/db/schema";
import { contactLeadsFromMetadata } from "../src/lib/sales/contact-leads";
import { isSellableProductRecord } from "../src/lib/sales/product-selection";

type CheckStatus = "pass" | "warn" | "fail";

type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type JsonRecord = Record<string, unknown>;

const REPORTS_DIR = "reports";
const DEFAULT_REPORT = `reports/local-acceptance-${new Date()
  .toISOString()
  .slice(0, 10)}.md`;
const REQUIRED_FILES = [
  "src/app/(app)/sales/page.tsx",
  "src/app/(app)/sales/actions.ts",
  "src/lib/sales/execution.ts",
  "src/lib/sales/tasks.ts",
  "src/lib/sales/contact-leads.ts",
  "src/lib/sales/contact-lead-fetch.ts",
  "src/lib/sales/outreach-kit.ts",
  "scripts/export-sales-tasks.ts",
  "scripts/export-contact-leads.ts",
  "scripts/sync-contact-leads.ts",
  "scripts/dedupe-products.ts",
  "scripts/prune-nonphysical-products.ts",
];

type Args = {
  markdown: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { markdown: DEFAULT_REPORT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--markdown" && next) {
      args.markdown = next;
      i++;
    } else if (arg === "--no-markdown") {
      args.markdown = null;
    }
  }
  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function stringValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function check(name: string, ok: boolean, detail: string): Check {
  return { name, status: ok ? "pass" : "fail", detail };
}

function warn(name: string, ok: boolean, detail: string): Check {
  return { name, status: ok ? "pass" : "warn", detail };
}

function latestReport(files: string[], prefix: string, suffix: string) {
  return files
    .filter((file) => file.startsWith(prefix) && file.endsWith(suffix))
    .sort()
    .at(-1);
}

function parseCsv(content: string) {
  const rows: string[][] = [[]];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      rows[rows.length - 1].push(cell);
      cell = "";
    } else if (char === "\n" && !inQuotes) {
      rows[rows.length - 1].push(cell);
      cell = "";
      rows.push([]);
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || rows[rows.length - 1].length > 0) {
    rows[rows.length - 1].push(cell);
  }

  return rows.filter((row) => row.some((value) => value.length > 0));
}

async function fileSize(path: string) {
  const info = await stat(path);
  return info.size;
}

function tableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function toMarkdown(checks: Check[]) {
  const failed = checks.filter((item) => item.status === "fail");
  const warned = checks.filter((item) => item.status === "warn");
  const passed = checks.length - failed.length - warned.length;
  const lines = [
    "# Local Acceptance Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Passed: ${passed}`,
    `- Warnings: ${warned.length}`,
    `- Failures: ${failed.length}`,
    `- Total checks: ${checks.length}`,
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
  ];

  for (const item of checks) {
    lines.push(
      `| ${item.status.toUpperCase()} | ${tableCell(item.name)} | ${tableCell(item.detail)} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks: Check[] = [];

  const productRows = await db
    .select({
      id: products.id,
      title: products.title,
      stage: products.stage,
      status: products.status,
      metadata: products.metadata,
    })
    .from(products);
  const nonSmokeProducts = productRows.filter(
    (product) => !product.title.startsWith("[SMOKE]")
  );
  const salesProducts = nonSmokeProducts.filter(isSellableProductRecord);
  const stageCounts = nonSmokeProducts.reduce<Record<string, number>>(
    (acc, product) => {
      acc[product.stage] = (acc[product.stage] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const [agentCount] = await db.select({ c: count() }).from(agents);
  const [openApprovalCount] = await db
    .select({ c: count() })
    .from(approvalQueue)
    .where(isNull(approvalQueue.decision));
  const [latestScoutRun] = await db
    .select({
      id: scoutRuns.id,
      scoredCount: scoutRuns.scoredCount,
      enqueuedCount: scoutRuns.enqueuedCount,
      errors: scoutRuns.errors,
    })
    .from(scoutRuns)
    .orderBy(desc(scoutRuns.startedAt))
    .limit(1);

  const productsWithScore = salesProducts.filter((product) => {
    const metadata = asRecord(product.metadata);
    return numberValue(asRecord(metadata?.shortlist), "score") !== null;
  });
  const productsWithSalesScaleScore = salesProducts.filter((product) => {
    const metadata = asRecord(product.metadata);
    const score = numberValue(asRecord(metadata?.shortlist), "score");
    return score !== null && score >= 1 && score <= 100;
  });
  const duplicateTitleCount = Array.from(
    salesProducts.reduce<Map<string, number>>((acc, product) => {
      const key = product.title.trim().replace(/\s+/g, " ").toLowerCase();
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map())
  ).filter(([, value]) => value > 1).length;
  const productsWithSourceUrl = salesProducts.filter((product) => {
    const metadata = asRecord(product.metadata);
    const signals = asRecord(metadata?.signals);
    const overseas = asRecord(signals?.overseas);
    return stringValue(overseas, "url") !== null;
  });
  const productsWithNextAction = salesProducts.filter((product) => {
    const metadata = asRecord(product.metadata);
    const salesReadiness = asRecord(metadata?.salesReadiness);
    const shortlist = asRecord(metadata?.shortlist);
    return (
      stringValue(salesReadiness, "nextAction") !== null ||
      stringValue(shortlist, "nextAction") !== null
    );
  });
  const productsWithContactLeads = salesProducts.filter((product) => {
    const snapshot = contactLeadsFromMetadata(product.metadata);
    return snapshot !== null && snapshot.candidates.length > 0;
  });

  checks.push(
    check(
      "DB商品数",
      salesProducts.length >= 30,
      `${salesProducts.length}/30 sellable physical product(s), all stages=${JSON.stringify(stageCounts)}`
    ),
    check(
      "スコア付き商品",
      productsWithScore.length >= 30,
      `${productsWithScore.length}/30 products include shortlist.score`
    ),
    check(
      "販売スコア尺度",
      productsWithSalesScaleScore.length >= 30,
      `${productsWithSalesScaleScore.length}/30 products include 1-100 sales score`
    ),
    check(
      "重複商品タイトル",
      duplicateTitleCount === 0,
      `${duplicateTitleCount} duplicate title group(s)`
    ),
    check(
      "一次ソースURL",
      productsWithSourceUrl.length >= 30,
      `${productsWithSourceUrl.length}/30 products include source URL`
    ),
    check(
      "次アクション",
      productsWithNextAction.length >= 30,
      `${productsWithNextAction.length}/30 products include next action`
    ),
    check(
      "連絡先候補同期",
      productsWithContactLeads.length >= 30,
      `${productsWithContactLeads.length}/30 products include synced contact leads`
    ),
    check(
      "エージェント",
      Number(agentCount?.c ?? 0) >= 10,
      `${Number(agentCount?.c ?? 0)} agent(s) seeded`
    ),
    warn(
      "承認待ち",
      Number(openApprovalCount?.c ?? 0) >= 30,
      `${Number(openApprovalCount?.c ?? 0)} open approval(s); can be lower after real review work`
    ),
    warn(
      "最新Scout実行",
      Boolean(
        latestScoutRun &&
          Number(latestScoutRun.scoredCount ?? 0) > 0 &&
          Array.isArray(latestScoutRun.errors) &&
          latestScoutRun.errors.length === 0
      ),
      latestScoutRun
        ? `run=${latestScoutRun.id} scored=${Number(latestScoutRun.scoredCount ?? 0)} enqueued=${Number(latestScoutRun.enqueuedCount ?? 0)} errors=${Array.isArray(latestScoutRun.errors) ? latestScoutRun.errors.length : "unknown"}`
        : "no scout run recorded; run pnpm scout:minimal to verify the research agent"
    )
  );

  for (const file of REQUIRED_FILES) {
    checks.push(check(`実装ファイル ${file}`, existsSync(file), file));
  }

  const reportFiles = await readdir(REPORTS_DIR);
  const scoutJson = latestReport(reportFiles, "scout-products-", ".json");
  const salesBoardCsv = latestReport(reportFiles, "sales-board-", ".csv");
  const salesBoardMd = latestReport(reportFiles, "sales-board-", ".md");
  const outreachCsv = latestReport(reportFiles, "outreach-kit-", ".csv");
  const outreachMd = latestReport(reportFiles, "outreach-kit-", ".md");
  const salesTasksCsv = latestReport(reportFiles, "sales-tasks-", ".csv");
  const salesTasksMd = latestReport(reportFiles, "sales-tasks-", ".md");
  const contactLeadsCsv = latestReport(reportFiles, "contact-leads-", ".csv");
  const contactLeadsMd = latestReport(reportFiles, "contact-leads-", ".md");
  const salesPackMd = latestReport(reportFiles, "sales-pack-", ".md");

  for (const file of [
    scoutJson,
    salesBoardCsv,
    salesBoardMd,
    outreachCsv,
    outreachMd,
    salesTasksCsv,
    salesTasksMd,
    contactLeadsCsv,
    contactLeadsMd,
    salesPackMd,
  ]) {
    checks.push(
      check(
        `レポート ${file ?? "missing"}`,
        Boolean(file),
        file ? `${join(REPORTS_DIR, file)} (${await fileSize(join(REPORTS_DIR, file))} bytes)` : "missing"
      )
    );
  }

  if (scoutJson) {
    const parsed = JSON.parse(
      await readFile(join(REPORTS_DIR, scoutJson), "utf8")
    ) as { items?: unknown[] };
    checks.push(
      check(
        "リサーチJSON",
        Array.isArray(parsed.items) && parsed.items.length >= 30,
        `${parsed.items?.length ?? 0} researched item(s)`
      )
    );
  }

  if (salesBoardCsv) {
    const rows = parseCsv(await readFile(join(REPORTS_DIR, salesBoardCsv), "utf8"));
    const header = rows[0] ?? [];
    checks.push(
      check("Sales Board CSV行数", rows.length >= 31, `${rows.length - 1} data row(s)`),
      check(
        "Sales Board商談列",
        ["sales_status", "next_follow_up_at", "follow_up_state"].every((name) =>
          header.includes(name)
        ),
        header.join(",")
      )
    );
  }

  if (outreachCsv) {
    const rows = parseCsv(await readFile(join(REPORTS_DIR, outreachCsv), "utf8"));
    const header = rows[0] ?? [];
    checks.push(
      check("Outreach CSV行数", rows.length >= 31, `${rows.length - 1} data row(s)`),
      check(
        "Outreachメール列",
        ["ja_subject", "ja_body", "en_subject", "en_body"].every((name) =>
          header.includes(name)
        ),
        header.join(",")
      )
    );
  }

  if (salesTasksCsv) {
    const rows = parseCsv(await readFile(join(REPORTS_DIR, salesTasksCsv), "utf8"));
    const header = rows[0] ?? [];
    checks.push(
      check("Sales Tasks CSV行数", rows.length >= 31, `${rows.length - 1} data row(s)`),
      check(
        "Sales Tasks実行列",
        ["task_priority", "task_type", "sales_status", "follow_up_state", "ja_subject"].every(
          (name) => header.includes(name)
        ),
        header.join(",")
      )
    );
  }

  if (contactLeadsCsv) {
    const rows = parseCsv(await readFile(join(REPORTS_DIR, contactLeadsCsv), "utf8"));
    const header = rows[0] ?? [];
    checks.push(
      check("Contact Leads CSV行数", rows.length >= 31, `${rows.length - 1} data row(s)`),
      check(
        "Contact Leads連絡先列",
        [
          "fetch_status",
          "primary_contact_type",
          "primary_contact",
          "emails",
          "contact_pages",
          "crowdfunding_links",
          "social_links",
        ].every((name) => header.includes(name)),
        header.join(",")
      )
    );
  }

  const failed = checks.filter((item) => item.status === "fail");
  const warned = checks.filter((item) => item.status === "warn");

  for (const item of checks) {
    const mark =
      item.status === "pass" ? "PASS" : item.status === "warn" ? "WARN" : "FAIL";
    console.log(`${mark} ${item.name} - ${item.detail}`);
  }

  console.log(
    `\nAcceptance: ${checks.length - failed.length - warned.length}/${checks.length} passed, ${warned.length} warning(s), ${failed.length} failure(s).`
  );

  if (args.markdown) {
    const reportPath = abs(args.markdown);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, toMarkdown(checks), "utf8");
    console.log(`wrote ${reportPath}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
