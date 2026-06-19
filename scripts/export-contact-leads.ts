import "./_loadenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { closeDb } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import type { Product } from "../src/lib/db/schema";
import {
  type ContactLeadCandidate,
  extractContactLeadCandidates,
} from "../src/lib/sales/contact-leads";
import {
  contactLookupHint,
  enSubject,
  jaSubject,
} from "../src/lib/sales/outreach-kit";

type Args = {
  csv: string;
  markdown: string;
  limit: number;
  timeoutMs: number;
  concurrency: number;
  maxCandidates: number;
};

type ProductWithSummary = Product & {
  pipelineSummary: Awaited<
    ReturnType<typeof getPipelineProductsByStage>
  >[Product["stage"]][number]["pipelineSummary"];
};

type ContactLeadRow = {
  product: ProductWithSummary;
  fetchStatus: string;
  candidates: ContactLeadCandidate[];
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
const DEFAULT_CSV = `reports/contact-leads-${DEFAULT_DATE}.csv`;
const DEFAULT_MD = `reports/contact-leads-${DEFAULT_DATE}.md`;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    csv: DEFAULT_CSV,
    markdown: DEFAULT_MD,
    limit: 30,
    timeoutMs: 8000,
    concurrency: 4,
    maxCandidates: 12,
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
    } else if (arg === "--timeout-ms" && next) {
      const parsed = Number(next);
      args.timeoutMs =
        Number.isFinite(parsed) && parsed >= 1000 ? Math.floor(parsed) : 8000;
      i++;
    } else if (arg === "--concurrency" && next) {
      const parsed = Number(next);
      args.concurrency =
        Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 8) : 4;
      i++;
    } else if (arg === "--max-candidates" && next) {
      const parsed = Number(next);
      args.maxCandidates =
        Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 12;
      i++;
    }
  }

  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function rankProducts(grouped: Awaited<ReturnType<typeof getPipelineProductsByStage>>) {
  return Object.values(grouped)
    .flat()
    .filter((product) => !product.title.startsWith("[SMOKE]"))
    .sort((a, b) => {
      const scoreA = a.pipelineSummary.shortlistScore ?? 0;
      const scoreB = b.pipelineSummary.shortlistScore ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const priorityA = a.pipelineSummary.salesPriority ?? 0;
      const priorityB = b.pipelineSummary.salesPriority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return a.title.localeCompare(b.title);
    });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]) {
  return values.map(csvCell).join(",");
}

function shortError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\s+/g, " ").slice(0, 120);
}

async function fetchHtml(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent":
          "Mozilla/5.0 (compatible; AgentCommandCenter/0.1; +https://github.com/pasway001/ai-agent-command)",
      },
    });
    const html = await response.text();
    return {
      status: response.ok ? `ok:${response.status}` : `http:${response.status}`,
      html,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function valuesByKind(row: ContactLeadRow, kind: ContactLeadCandidate["kind"]) {
  return row.candidates
    .filter((candidate) => candidate.kind === kind)
    .map((candidate) => candidate.value);
}

function leadList(values: string[]) {
  return values.length > 0 ? values.join(" / ") : "";
}

function primary(row: ContactLeadRow) {
  return row.candidates[0] ?? null;
}

async function buildContactLeadRow(
  product: ProductWithSummary,
  timeoutMs: number,
  maxCandidates: number
): Promise<ContactLeadRow> {
  const sourceUrl = product.pipelineSummary.sourceUrl;
  if (!sourceUrl) {
    return { product, fetchStatus: "missing_source_url", candidates: [] };
  }

  try {
    const fetched = await fetchHtml(sourceUrl, timeoutMs);
    return {
      product,
      fetchStatus: fetched.status,
      candidates: extractContactLeadCandidates(fetched.html, sourceUrl, maxCandidates),
    };
  } catch (err) {
    return {
      product,
      fetchStatus: `error:${shortError(err)}`,
      candidates: [],
    };
  }
}

function toCsv(rows: ContactLeadRow[]) {
  const header = [
    "rank",
    "title",
    "score",
    "stage",
    "source",
    "source_url",
    "fetch_status",
    "primary_contact_type",
    "primary_contact",
    "emails",
    "contact_pages",
    "official_sites",
    "crowdfunding_links",
    "social_links",
    "external_links",
    "contact_lookup_hint",
    "ja_subject",
    "en_subject",
    "next_action",
  ];

  const body = rows.map((row, index) => {
    const { product } = row;
    const summary = product.pipelineSummary;
    const top = primary(row);
    return csvLine([
      index + 1,
      product.title,
      summary.shortlistScore,
      product.stage,
      summary.sourceName,
      summary.sourceUrl,
      row.fetchStatus,
      top?.kind,
      top?.value,
      leadList(valuesByKind(row, "email")),
      leadList(valuesByKind(row, "contact_page")),
      leadList(valuesByKind(row, "official_site")),
      leadList(valuesByKind(row, "crowdfunding")),
      leadList(valuesByKind(row, "social")),
      leadList(valuesByKind(row, "external_link")),
      contactLookupHint(product),
      jaSubject(product),
      enSubject(product),
      summary.nextAction,
    ]);
  });

  return [csvLine(header), ...body].join("\n") + "\n";
}

function statusSummary(rows: ContactLeadRow[]) {
  const directEmails = rows.filter((row) => valuesByKind(row, "email").length > 0).length;
  const contactPages = rows.filter(
    (row) => valuesByKind(row, "contact_page").length > 0
  ).length;
  const crowdfunding = rows.filter(
    (row) => valuesByKind(row, "crowdfunding").length > 0
  ).length;
  const anyLead = rows.filter((row) => row.candidates.length > 0).length;
  const okFetch = rows.filter((row) => row.fetchStatus.startsWith("ok:")).length;
  return { directEmails, contactPages, crowdfunding, anyLead, okFetch };
}

function toMarkdown(rows: ContactLeadRow[]) {
  const summary = statusSummary(rows);
  const lines = [
    "# Contact Leads",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Products: ${rows.length}`,
    "",
    "## Summary",
    "",
    `- Source fetch OK: ${summary.okFetch}`,
    `- Products with any lead: ${summary.anyLead}`,
    `- Direct email found: ${summary.directEmails}`,
    `- Contact page found: ${summary.contactPages}`,
    `- Crowdfunding link found: ${summary.crowdfunding}`,
    "",
    "## Leads",
    "",
  ];

  for (const [index, row] of rows.entries()) {
    const { product } = row;
    const summary = product.pipelineSummary;
    const top = primary(row);
    lines.push(
      `### ${index + 1}. ${product.title}`,
      "",
      `- Score: ${summary.shortlistScore ?? "-"} / Stage: ${product.stage}`,
      `- Source: ${summary.sourceName ?? "-"}${summary.sourceUrl ? ` <${summary.sourceUrl}>` : ""}`,
      `- Fetch: ${row.fetchStatus}`,
      `- Primary: ${top ? `${top.kind} / ${top.value}` : "-"}`,
      `- Emails: ${leadList(valuesByKind(row, "email")) || "-"}`,
      `- Contact pages: ${leadList(valuesByKind(row, "contact_page")) || "-"}`,
      `- Official sites: ${leadList(valuesByKind(row, "official_site")) || "-"}`,
      `- Crowdfunding: ${leadList(valuesByKind(row, "crowdfunding")) || "-"}`,
      `- Social: ${leadList(valuesByKind(row, "social")) || "-"}`,
      `- Other external: ${leadList(valuesByKind(row, "external_link")) || "-"}`,
      `- Contact lookup: ${contactLookupHint(product)}`,
      `- JA subject: ${jaSubject(product)}`,
      `- EN subject: ${enSubject(product)}`,
      `- Next action: ${summary.nextAction ?? "-"}`,
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

  const rows = await mapLimit(products, args.concurrency, (product) =>
    buildContactLeadRow(product, args.timeoutMs, args.maxCandidates)
  );
  const csvPath = abs(args.csv);
  const mdPath = abs(args.markdown);
  await mkdir(dirname(csvPath), { recursive: true });
  await mkdir(dirname(mdPath), { recursive: true });
  await writeFile(csvPath, toCsv(rows), "utf8");
  await writeFile(mdPath, toMarkdown(rows), "utf8");

  const summary = statusSummary(rows);
  console.log(`wrote ${csvPath}`);
  console.log(`wrote ${mdPath}`);
  console.log(
    `exported ${rows.length} contact lead row(s); ${summary.anyLead} with leads, ${summary.directEmails} with direct email(s)`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
