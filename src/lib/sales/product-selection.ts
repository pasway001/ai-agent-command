import type { Product } from "../db/schema";

type JsonRecord = Record<string, unknown>;

type ProductRecordForSelection = Pick<
  Product,
  "title" | "stage" | "status" | "metadata"
>;

type PipelineSummaryForSales = {
  shortlistScore: number | null;
  salesPriority: number | null;
};

export type SalesSelectableProduct = ProductRecordForSelection & {
  pipelineSummary: PipelineSummaryForSales;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function hasSalesScore(product: { pipelineSummary?: PipelineSummaryForSales }) {
  const score = product.pipelineSummary?.shortlistScore;
  return typeof score === "number" && Number.isFinite(score) && score > 0;
}

function isPhysicalFromMetadata(metadataValue: unknown) {
  const signals = asRecord(asRecord(metadataValue)?.signals);
  return (
    signals?.productType === "physical" ||
    signals?.physicalProductLikely === true
  );
}

export function isSellableProductRecord(product: ProductRecordForSelection) {
  return (
    !product.title.startsWith("[SMOKE]") &&
    product.stage !== "archived" &&
    product.status !== "rejected" &&
    isPhysicalFromMetadata(product.metadata)
  );
}

export function rankSalesProducts<T extends SalesSelectableProduct>(
  grouped: Record<string, T[]>
) {
  return Object.values(grouped)
    .flat()
    .filter((product) => isSellableProductRecord(product) && hasSalesScore(product))
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
