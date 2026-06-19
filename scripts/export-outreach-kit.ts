import "./_loadenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { closeDb } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import type { Product } from "../src/lib/db/schema";
import {
  complianceNeeds,
  contactLookupHint,
  enBody,
  enSubject,
  firstQuestions,
  jaBody,
  jaSubject,
} from "../src/lib/sales/outreach-kit";
import { rankSalesProducts } from "../src/lib/sales/product-selection";

type Args = {
  csv: string;
  markdown: string;
  limit: number;
};

type ProductWithSummary = Product & {
  pipelineSummary: Awaited<
    ReturnType<typeof getPipelineProductsByStage>
  >[Product["stage"]][number]["pipelineSummary"];
};

const DEFAULT_CSV = "reports/outreach-kit-2026-06-19.csv";
const DEFAULT_MD = "reports/outreach-kit-2026-06-19.md";

function parseArgs(argv: string[]): Args {
  const args: Args = { csv: DEFAULT_CSV, markdown: DEFAULT_MD, limit: 30 };
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
    }
  }
  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function rankProducts(grouped: Awaited<ReturnType<typeof getPipelineProductsByStage>>) {
  return rankSalesProducts(grouped);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function toCsv(products: ProductWithSummary[]) {
  const header = [
    "rank",
    "title",
    "score",
    "stage",
    "source",
    "source_url",
    "contact_lookup_hint",
    "next_action",
    "required_checks",
    "first_questions",
    "ja_subject",
    "ja_body",
    "en_subject",
    "en_body",
  ];

  const rows = products.map((product, index) => {
    const summary = product.pipelineSummary;
    return csvLine([
      index + 1,
      product.title,
      summary.shortlistScore,
      product.stage,
      summary.sourceName,
      summary.sourceUrl,
      contactLookupHint(product),
      summary.nextAction,
      complianceNeeds(product).join(" / "),
      firstQuestions(product).join(" / "),
      jaSubject(product),
      jaBody(product),
      enSubject(product),
      enBody(product),
    ]);
  });

  return [csvLine(header), ...rows].join("\n") + "\n";
}

function toMarkdown(products: ProductWithSummary[]) {
  const lines = [
    "# Outreach Kit",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Products: ${products.length}`,
    "",
    "## Product Outreach Drafts",
    "",
  ];

  for (const [index, product] of products.entries()) {
    const summary = product.pipelineSummary;
    lines.push(
      `### ${index + 1}. ${product.title}`,
      "",
      `- Score: ${summary.shortlistScore ?? "-"} / Stage: ${product.stage}`,
      `- Source: ${summary.sourceName ?? "-"}${summary.sourceUrl ? ` <${summary.sourceUrl}>` : ""}`,
      `- Contact lookup: ${contactLookupHint(product)}`,
      `- Required checks: ${complianceNeeds(product).join(" / ")}`,
      `- Next action: ${summary.nextAction ?? "-"}`,
      "",
      "#### 日本語メール",
      "",
      `Subject: ${jaSubject(product)}`,
      "",
      "```text",
      jaBody(product),
      "```",
      "",
      "#### English Email",
      "",
      `Subject: ${enSubject(product)}`,
      "",
      "```text",
      enBody(product),
      "```",
      ""
    );
  }

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const grouped = await getPipelineProductsByStage();
  const products = rankProducts(grouped).slice(0, args.limit);
  if (products.length === 0) {
    throw new Error("No products found in the local DB. Run pnpm local:bootstrap first.");
  }

  const csvPath = abs(args.csv);
  const mdPath = abs(args.markdown);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(csvPath, toCsv(products), "utf8");
  await writeFile(mdPath, toMarkdown(products), "utf8");

  console.log(`wrote ${csvPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(`exported ${products.length} product(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
