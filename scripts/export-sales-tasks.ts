import "./_loadenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { closeDb } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import type { Product } from "../src/lib/db/schema";
import {
  SALES_EXECUTION_LABELS,
  salesExecutionFromMetadata,
} from "../src/lib/sales/execution";
import {
  SALES_TASK_PRIORITY_LABELS,
  SALES_TASK_TYPE_LABELS,
  salesTaskDescriptor,
  salesTaskSortScore,
  type SalesTaskDescriptor,
} from "../src/lib/sales/tasks";
import {
  complianceNeeds,
  contactLookupHint,
  enSubject,
  jaSubject,
} from "../src/lib/sales/outreach-kit";

type Args = {
  csv: string;
  markdown: string;
  limit: number;
  includeClosed: boolean;
};

type ProductWithSummary = Product & {
  pipelineSummary: Awaited<
    ReturnType<typeof getPipelineProductsByStage>
  >[Product["stage"]][number]["pipelineSummary"];
};

type SalesTaskRow = {
  product: ProductWithSummary;
  descriptor: SalesTaskDescriptor;
  salesStatus: ReturnType<typeof salesExecutionFromMetadata>["status"];
  supplierEmail: string | null;
  nextFollowUpAt: string | null;
  note: string | null;
};

function tokyoDateSlug(date = new Date()) {
  const parts = new Intl.DateTimeFormat("ja-JP-u-ca-gregory", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const DEFAULT_DATE = tokyoDateSlug();
const DEFAULT_CSV = `reports/sales-tasks-${DEFAULT_DATE}.csv`;
const DEFAULT_MD = `reports/sales-tasks-${DEFAULT_DATE}.md`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    csv: DEFAULT_CSV,
    markdown: DEFAULT_MD,
    limit: 30,
    includeClosed: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--csv" && next) {
      args.csv = next;
      i++;
    } else if (arg === "--markdown" && next) {
      args.markdown = next;
      i++;
    } else if (arg === "--limit" && next) {
      const parsed = Number(next);
      args.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30;
      i++;
    } else if (arg === "--include-closed") {
      args.includeClosed = true;
    }
  }

  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function salesTaskAction(row: SalesTaskRow) {
  const label = SALES_EXECUTION_LABELS[row.salesStatus];
  if (row.descriptor.taskType === "follow_up") {
    return `前回ステータス「${label}」の追客。返信、条件、サンプル、次回期限を更新する。`;
  }
  if (row.descriptor.taskType === "active_deal") {
    return `商談中ステータス「${label}」を進める。MOQ、卸価格、サンプル、販売権を確認する。`;
  }
  if (row.descriptor.taskType === "initial_outreach") {
    return "連絡先を特定し、日本語/英語の初回打診メールを送る。";
  }
  return `ステータス「${label}」のため、必要なら結果メモだけ更新する。`;
}

function buildTaskRows(
  grouped: Awaited<ReturnType<typeof getPipelineProductsByStage>>,
  includeClosed: boolean
) {
  const now = new Date();
  const rows = Object.values(grouped)
    .flat()
    .filter((product) => !product.title.startsWith("[SMOKE]"))
    .map((product) => {
      const execution = salesExecutionFromMetadata(product.metadata);
      return {
        product,
        descriptor: salesTaskDescriptor(execution, now),
        salesStatus: execution.status,
        supplierEmail: execution.supplierEmail,
        nextFollowUpAt: execution.nextFollowUpAt,
        note: execution.note,
      };
    })
    .filter((row) => includeClosed || row.descriptor.taskType !== "closed");

  return rows.sort((a, b) => {
    const scoreA = salesTaskSortScore(
      a.descriptor,
      a.product.pipelineSummary.shortlistScore,
      a.product.pipelineSummary.salesPriority
    );
    const scoreB = salesTaskSortScore(
      b.descriptor,
      b.product.pipelineSummary.shortlistScore,
      b.product.pipelineSummary.salesPriority
    );
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.product.title.localeCompare(b.product.title);
  });
}

function toCsv(rows: SalesTaskRow[]) {
  const header = [
    "rank",
    "task_priority",
    "task_type",
    "task_action",
    "title",
    "score",
    "sales_priority",
    "stage",
    "product_status",
    "sales_status",
    "follow_up_state",
    "next_follow_up_at",
    "supplier_email",
    "contact_lookup_hint",
    "source",
    "source_url",
    "next_action",
    "japan_angle",
    "required_checks",
    "ja_subject",
    "en_subject",
    "sales_note",
  ];

  const body = rows.map((row, index) => {
    const { product } = row;
    const summary = product.pipelineSummary;
    return csvLine([
      index + 1,
      SALES_TASK_PRIORITY_LABELS[row.descriptor.taskPriority],
      SALES_TASK_TYPE_LABELS[row.descriptor.taskType],
      salesTaskAction(row),
      product.title,
      summary.shortlistScore,
      summary.salesPriority,
      product.stage,
      product.status,
      SALES_EXECUTION_LABELS[row.salesStatus],
      row.descriptor.followUpState,
      row.nextFollowUpAt,
      row.supplierEmail,
      contactLookupHint(product),
      summary.sourceName,
      summary.sourceUrl,
      summary.nextAction,
      summary.japanAngle,
      complianceNeeds(product).join(" / "),
      jaSubject(product),
      enSubject(product),
      row.note,
    ]);
  });

  return [csvLine(header), ...body].join("\n") + "\n";
}

function countByTaskType(rows: SalesTaskRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const key = SALES_TASK_TYPE_LABELS[row.descriptor.taskType];
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function toMarkdown(rows: SalesTaskRow[]) {
  const counts = countByTaskType(rows);
  const lines = [
    "# Sales Tasks",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Tasks: ${rows.length}`,
    "",
    "## Summary",
    "",
    ...Object.entries(counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Today",
    "",
  ];

  for (const [index, row] of rows.entries()) {
    const { product } = row;
    const summary = product.pipelineSummary;
    lines.push(
      `### ${index + 1}. [${SALES_TASK_PRIORITY_LABELS[row.descriptor.taskPriority]}] ${product.title}`,
      "",
      `- Task: ${SALES_TASK_TYPE_LABELS[row.descriptor.taskType]} / ${salesTaskAction(row)}`,
      `- Sales: ${SALES_EXECUTION_LABELS[row.salesStatus]} / Follow-up: ${row.descriptor.followUpState}${row.nextFollowUpAt ? ` / ${row.nextFollowUpAt.slice(0, 10)}` : ""}`,
      `- Score: ${summary.shortlistScore ?? "-"} / Priority: ${summary.salesPriority ?? "-"} / Stage: ${product.stage}`,
      `- Contact lookup: ${contactLookupHint(product)}`,
      `- Checks: ${complianceNeeds(product).join(" / ")}`,
      `- Next action: ${summary.nextAction ?? "-"}`,
      `- Japan angle: ${summary.japanAngle ?? "-"}`,
      `- Source: ${summary.sourceName ?? "-"}${summary.sourceUrl ? ` <${summary.sourceUrl}>` : ""}`,
      `- JA subject: ${jaSubject(product)}`,
      `- EN subject: ${enSubject(product)}`,
      row.note ? `- Note: ${row.note}` : "- Note: -",
      ""
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const grouped = await getPipelineProductsByStage();
  const rows = buildTaskRows(grouped, args.includeClosed).slice(0, args.limit);
  if (rows.length === 0) {
    throw new Error("No sales tasks found in the local DB. Run pnpm local:bootstrap first.");
  }

  const csvPath = abs(args.csv);
  const mdPath = abs(args.markdown);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(csvPath, toCsv(rows), "utf8");
  await writeFile(mdPath, toMarkdown(rows), "utf8");

  console.log(`wrote ${csvPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(`exported ${rows.length} sales task(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
