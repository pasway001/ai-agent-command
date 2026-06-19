import "./_loadenv";
import { eq } from "drizzle-orm";
import { closeDb, db } from "../src/lib/db";
import { getPipelineProductsByStage } from "../src/lib/db/queries";
import { products as productsTable, type Product } from "../src/lib/db/schema";
import {
  fetchContactLeadSnapshot,
  mapLimit,
} from "../src/lib/sales/contact-lead-fetch";
import { rankSalesProducts } from "../src/lib/sales/product-selection";

type Args = {
  limit: number;
  timeoutMs: number;
  concurrency: number;
  maxCandidates: number;
  dryRun: boolean;
};

type ProductWithSummary = Product & {
  pipelineSummary: Awaited<
    ReturnType<typeof getPipelineProductsByStage>
  >[Product["stage"]][number]["pipelineSummary"];
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 30,
    timeoutMs: 8000,
    concurrency: 4,
    maxCandidates: 12,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--limit" && next) {
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
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function rankProducts(grouped: Awaited<ReturnType<typeof getPipelineProductsByStage>>) {
  return rankSalesProducts(grouped);
}

async function syncProductContactLeads(
  product: ProductWithSummary,
  args: Args,
  fetchedAt: string
) {
  const snapshot = await fetchContactLeadSnapshot({
    sourceUrl: product.pipelineSummary.sourceUrl,
    timeoutMs: args.timeoutMs,
    maxCandidates: args.maxCandidates,
    fetchedAt,
  });

  if (!args.dryRun) {
    await db
      .update(productsTable)
      .set({
        metadata: {
          ...(product.metadata ?? {}),
          contactLeads: snapshot,
        },
        updatedAt: new Date(),
      })
      .where(eq(productsTable.id, product.id));
  }

  return {
    title: product.title,
    fetchStatus: snapshot.fetchStatus,
    candidates: snapshot.candidates.length,
    primary: snapshot.candidates[0]?.value ?? null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const grouped = await getPipelineProductsByStage();
  const targetProducts = rankProducts(grouped).slice(0, args.limit);
  if (targetProducts.length === 0) {
    throw new Error("No products found in the local DB. Run pnpm local:bootstrap first.");
  }

  const fetchedAt = new Date().toISOString();
  const results = await mapLimit(targetProducts, args.concurrency, (product) =>
    syncProductContactLeads(product, args, fetchedAt)
  );
  const synced = args.dryRun ? 0 : results.length;
  const withLead = results.filter((result) => result.candidates > 0).length;
  const okFetch = results.filter((result) => result.fetchStatus.startsWith("ok:")).length;

  console.log(
    `${args.dryRun ? "checked" : "synced"} ${results.length} product(s); ${okFetch} source fetch OK; ${withLead} with contact lead(s)`
  );
  console.log(`DB updates: ${synced}`);
  for (const [index, result] of results.entries()) {
    console.log(
      `${index + 1}. ${result.fetchStatus} / ${result.candidates} lead(s) / ${result.title}${result.primary ? ` / ${result.primary}` : ""}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
