import "./_loadenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { closeDb } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import type { Product } from "../src/lib/db/schema";
import {
  SALES_EXECUTION_LABELS,
  followUpState,
  salesExecutionFromMetadata,
} from "../src/lib/sales/execution";
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

const DEFAULT_CSV = "reports/sales-board-2026-06-19.csv";
const DEFAULT_MD = "reports/sales-board-2026-06-19.md";

function parseArgs(argv: string[]): Args {
  const args: Args = {
    csv: DEFAULT_CSV,
    markdown: DEFAULT_MD,
    limit: 30,
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
    }
  }

  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function textFor(product: ProductWithSummary) {
  const summary = product.pipelineSummary;
  return [
    product.title,
    summary.japanAngle,
    summary.nextAction,
    summary.salesReasons.join(" "),
    summary.salesRisks.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function categoryFor(product: ProductWithSummary) {
  const text = textFor(product);
  if (/\b(sleep|mask|pillow|headphones|air purifier|wellness|calm)\b/i.test(text)) {
    return "ウェルネス/睡眠";
  }
  if (/\b(light|flashlight|bulb|speaker|dock|display|hub|earbuds|sensor|robot|joystick|clock)\b/i.test(text)) {
    return "ガジェット/家電";
  }
  if (/\b(bag|wallet|jewelry|watch|pins|pendants|earrings|wearable art)\b/i.test(text)) {
    return "ファッション/アクセサリー";
  }
  if (/\b(kitchen|cutting board|chef|coffee|bottle|shower)\b/i.test(text)) {
    return "キッチン/生活雑貨";
  }
  if (/\b(mower|tufting|tool|driver|controller|diy)\b/i.test(text)) {
    return "工具/ホビー";
  }
  return "生活改善プロダクト";
}

function priceRange(product: ProductWithSummary) {
  const text = textFor(product);
  if (/\b(robot|mower|machine|tufting|terminal|hub)\b/i.test(text)) {
    return { min: 39800, max: 99800 };
  }
  if (/\b(earbuds|headphones|speaker|dock|display|watch|air purifier|sleep system)\b/i.test(text)) {
    return { min: 12800, max: 39800 };
  }
  if (/\b(bag|pins|pendants|earrings|cutting board|flashlight|bulb|clock|sensor)\b/i.test(text)) {
    return { min: 4980, max: 14800 };
  }
  return { min: 8800, max: 24800 };
}

function complianceFlags(product: ProductWithSummary) {
  const risks = product.pipelineSummary.salesRisks.join(" ");
  return {
    pse: risks.includes("PSE"),
    giteki: risks.includes("技適"),
    food: risks.includes("食品衛生"),
    trademark: risks.includes("商標") || risks.includes("通常の輸入"),
  };
}

function targetLandedCostMax(retailMin: number) {
  // Keeps room for CF platform fee, ad tests, domestic fulfillment, defects, and profit.
  return Math.floor(retailMin * 0.35);
}

function grossProfitAtTarget(retailMin: number) {
  const landed = targetLandedCostMax(retailMin);
  return {
    landed,
    grossProfit: retailMin - landed,
    grossMarginPct: Math.round(((retailMin - landed) / retailMin) * 100),
  };
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
    "stage",
    "status",
    "title",
    "score",
    "sales_priority",
    "category",
    "target_retail_min_jpy",
    "target_retail_max_jpy",
    "target_landed_cost_max_jpy",
    "gross_profit_at_min_jpy",
    "gross_margin_pct",
    "pse_check",
    "giteki_check",
    "food_sanitation_check",
    "trademark_supplier_check",
    "next_action",
    "japan_angle",
    "risks",
    "source",
    "source_url",
    "lp_headline",
    "lp_risk",
    "lp_faq_count",
    "lp_image_count",
    "sales_status",
    "supplier_email",
    "next_follow_up_at",
    "follow_up_state",
    "sales_note",
  ];

  const rows = products.map((product, index) => {
    const price = priceRange(product);
    const unit = grossProfitAtTarget(price.min);
    const flags = complianceFlags(product);
    const summary = product.pipelineSummary;
    const execution = salesExecutionFromMetadata(product.metadata);
    return csvLine([
      index + 1,
      product.stage,
      product.status,
      product.title,
      summary.shortlistScore,
      summary.salesPriority,
      categoryFor(product),
      price.min,
      price.max,
      unit.landed,
      unit.grossProfit,
      unit.grossMarginPct,
      flags.pse ? "required" : "",
      flags.giteki ? "required" : "",
      flags.food ? "required" : "",
      flags.trademark ? "required" : "recommended",
      summary.nextAction,
      summary.japanAngle,
      summary.salesRisks.join(" / "),
      summary.sourceName,
      summary.sourceUrl,
      summary.lpHeadline,
      summary.lpRiskLevel,
      summary.lpFaqCount,
      summary.lpImageCount,
      SALES_EXECUTION_LABELS[execution.status],
      execution.supplierEmail,
      execution.nextFollowUpAt,
      followUpState(execution),
      execution.note,
    ]);
  });

  return [csvLine(header), ...rows].join("\n") + "\n";
}

function yen(value: number) {
  return `${value.toLocaleString("ja-JP")}円`;
}

function toMarkdown(products: ProductWithSummary[]) {
  const lines = [
    "# Sales Board",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Products: ${products.length}`,
    "",
    "## Priority List",
    "",
  ];

  for (const [index, product] of products.entries()) {
    const summary = product.pipelineSummary;
    const price = priceRange(product);
    const unit = grossProfitAtTarget(price.min);
    const flags = complianceFlags(product);
    const execution = salesExecutionFromMetadata(product.metadata);
    const checks = [
      flags.pse ? "PSE" : null,
      flags.giteki ? "技適" : null,
      flags.food ? "食品衛生" : null,
      flags.trademark ? "商標/代理店" : "商標推奨",
    ].filter(Boolean);

    lines.push(
      `### ${index + 1}. ${product.title}`,
      "",
      `- Stage: ${product.stage} / Status: ${product.status} / Score: ${summary.shortlistScore ?? "-"} / Priority: ${summary.salesPriority ?? "-"}`,
      `- Category: ${categoryFor(product)}`,
      `- Target retail: ${yen(price.min)}〜${yen(price.max)}`,
      `- Target landed cost max: ${yen(unit.landed)} (gross margin ${unit.grossMarginPct}%)`,
      `- Next action: ${summary.nextAction ?? "-"}`,
      `- Japan angle: ${summary.japanAngle ?? "-"}`,
      `- Checks: ${checks.join(" / ")}`,
      `- Risks: ${summary.salesRisks.join(" / ") || "-"}`,
      `- Source: ${summary.sourceName ?? "-"}${summary.sourceUrl ? ` <${summary.sourceUrl}>` : ""}`,
      `- Sales: ${SALES_EXECUTION_LABELS[execution.status]}${execution.nextFollowUpAt ? ` / Next: ${execution.nextFollowUpAt.slice(0, 10)} / ${followUpState(execution)}` : ""}`,
      `- LP asset: ${summary.lpHeadline ? `${summary.lpHeadline} / risk=${summary.lpRiskLevel ?? "-"}` : "not generated"}`,
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
