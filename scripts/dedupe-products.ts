import "./_loadenv";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "../src/lib/db";
import {
  agentEvaluations,
  agentRuns,
  approvalQueue,
  products,
  type Product,
} from "../src/lib/db/schema";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function deepMerge(base: JsonRecord, patch: JsonRecord): JsonRecord {
  const out: JsonRecord = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current as JsonRecord, value as JsonRecord);
    } else if (value !== undefined && value !== null) {
      out[key] = value;
    }
  }
  return out;
}

function normalizedTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function candidateWeight(product: Product) {
  const metadata = asRecord(product.metadata);
  const shortlist = asRecord(metadata.shortlist);
  const contactLeads = asRecord(metadata.contactLeads);
  const candidates = Array.isArray(contactLeads.candidates)
    ? contactLeads.candidates.length
    : 0;
  const score = numberValue(shortlist.score);
  const sourceUrl = asRecord(asRecord(metadata.signals).overseas).url ? 1 : 0;
  return score * 100 + candidates * 10 + sourceUrl;
}

function chooseCanonical(group: Product[]) {
  return group
    .slice()
    .sort((a, b) => {
      const weight = candidateWeight(b) - candidateWeight(a);
      if (weight !== 0) return weight;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })[0];
}

async function removeDuplicateOpenApprovals(productId: string) {
  const openApprovals = await db
    .select({
      id: approvalQueue.id,
      priority: approvalQueue.priority,
      createdAt: approvalQueue.createdAt,
    })
    .from(approvalQueue)
    .where(and(eq(approvalQueue.productId, productId), isNull(approvalQueue.decision)));

  if (openApprovals.length <= 1) return 0;
  const [keep, ...remove] = openApprovals.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  for (const item of remove) {
    await db.delete(approvalQueue).where(eq(approvalQueue.id, item.id));
  }
  return keep ? remove.length : 0;
}

async function main() {
  const allProducts = await db.select().from(products);
  const groups = new Map<string, Product[]>();
  for (const product of allProducts) {
    const key = normalizedTitle(product.title);
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }

  let mergedProducts = 0;
  let removedApprovals = 0;
  for (const group of groups.values()) {
    const canonical = chooseCanonical(group);
    if (group.length <= 1) {
      removedApprovals += await removeDuplicateOpenApprovals(canonical.id);
      continue;
    }
    const duplicates = group.filter((product) => product.id !== canonical.id);
    let mergedMetadata = asRecord(canonical.metadata);
    for (const duplicate of duplicates) {
      mergedMetadata = deepMerge(mergedMetadata, asRecord(duplicate.metadata));
      await db
        .update(agentRuns)
        .set({ productId: canonical.id })
        .where(eq(agentRuns.productId, duplicate.id));
      await db
        .update(agentEvaluations)
        .set({ productId: canonical.id })
        .where(eq(agentEvaluations.productId, duplicate.id));
      await db
        .update(approvalQueue)
        .set({ productId: canonical.id })
        .where(eq(approvalQueue.productId, duplicate.id));
      await db.delete(products).where(eq(products.id, duplicate.id));
      mergedProducts++;
    }
    await db
      .update(products)
      .set({ metadata: mergedMetadata, updatedAt: new Date() })
      .where(eq(products.id, canonical.id));
    removedApprovals += await removeDuplicateOpenApprovals(canonical.id);
  }

  console.log(
    `deduped ${mergedProducts} product row(s); removed ${removedApprovals} duplicate open approval(s)`
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
