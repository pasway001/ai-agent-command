import "./_loadenv";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "../src/lib/db";
import { approvalQueue, products } from "../src/lib/db/schema";
import {
  classifyProductText,
  isPhysicalProductCandidate,
} from "../src/lib/agents/product-classification";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function main() {
  const rows = await db.select().from(products);
  let archived = 0;
  let closedApprovals = 0;

  for (const product of rows) {
    if (product.title.startsWith("[SMOKE]")) continue;
    const metadata = asRecord(product.metadata);
    const signals = asRecord(metadata.signals);
    const overseas = asRecord(signals.overseas);
    const classification = classifyProductText({
      title: product.title,
      description: stringValue(overseas, "description"),
      source: stringValue(overseas, "source"),
    });
    if (isPhysicalProductCandidate(classification)) continue;

    if (product.stage !== "archived" || product.status !== "rejected") {
      await db
        .update(products)
        .set({
          stage: "archived",
          status: "rejected",
          metadata: {
            ...metadata,
            signals: {
              ...signals,
              productType: classification.productType,
              physicalProductLikely: classification.physicalProductLikely,
              exclusionReason: classification.exclusionReason,
            },
            archivedReason:
              classification.exclusionReason ??
              "物理商品ではないため販売候補から除外",
          },
          updatedAt: new Date(),
        })
        .where(eq(products.id, product.id));
      archived++;
    }

    const openApprovals = await db
      .update(approvalQueue)
      .set({
        decision: "reject",
        decidedAt: new Date(),
        decisionNote:
          classification.exclusionReason ??
          "物理商品ではないため販売候補から除外",
      })
      .where(and(eq(approvalQueue.productId, product.id), isNull(approvalQueue.decision)))
      .returning({ id: approvalQueue.id });
    closedApprovals += openApprovals.length;
  }

  console.log(
    `archived ${archived} non-physical product(s); closed ${closedApprovals} open approval(s)`
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
