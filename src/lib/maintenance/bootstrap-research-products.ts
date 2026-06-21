import { eq } from "drizzle-orm";
import bundledResearchProducts from "../../../reports/scout-products-2026-06-21.json";
import { db } from "../db";
import { agents, products, type NewProduct, type Product } from "../db/schema";

const AGENT_ID = "scout.scoring";
const DEFAULT_INPUT = "reports/scout-products-2026-06-21.json";

type ResearchJson = {
  generatedAt?: string;
  items?: ResearchItem[];
};

type ResearchItem = {
  rank: number;
  title: string;
  source: string;
  market?: "global" | "japan";
  url: string;
  score: number;
  publishedAt: string | null;
  reasons: string[];
  risks: string[];
  japanAngle: string;
  nextAction: string;
  description: string;
};

export type BootstrapResearchProductsResult = {
  input: string;
  items: number;
  imported: number;
  inserted: number;
  updated: number;
  existingOpenApprovals: number;
};

function priorityFor(score: number) {
  if (score >= 90) return 9;
  if (score >= 84) return 7;
  if (score >= 80) return 5;
  return 3;
}

function signalsFor(item: ResearchItem) {
  return {
    title: item.title,
    category: `${item.source} shortlist rank ${item.rank}`,
    productType: "physical" as const,
    physicalProductLikely: true,
    market: item.market ?? "global",
    overseas: {
      source: item.source,
      url: item.url || undefined,
      description: item.description,
      publishedAt: item.publishedAt ?? undefined,
    },
    japan: {
      notYetInJapan: undefined,
      searchSummary: item.japanAngle,
      japanValidationLevel: item.market === "japan" ? 0.7 : 0.3,
    },
    mentionSources: [item.source],
    crossSourceScore: 0.2,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
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
      out[key] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizedTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function productPatchFor(item: ResearchItem, generatedAt: string | undefined) {
  const signals = signalsFor(item);
  return {
    signals,
    shortlist: item,
    salesReadiness: {
      sourceReportGeneratedAt: generatedAt ?? null,
      importedAt: new Date().toISOString(),
      priority: priorityFor(item.score),
      nextAction: item.nextAction,
      risks: item.risks,
      reasons: item.reasons,
    },
  };
}

async function ensureScoutAgent() {
  await db
    .insert(agents)
    .values({
      id: AGENT_ID,
      name: "商品候補スコアリング",
      systemNo: 1,
      agentType: "scout",
      description:
        "海外・国内の無料ソース/手動入力シグナルを統合し、候補をスコアリングしてInboxへ送る",
      scheduleCron: "30 8 * * *",
      concurrencyLimit: 1,
      dailyBudgetUsd: "1",
      monthlyBudgetUsd: "20",
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: "商品候補スコアリング",
        description:
          "海外・国内の無料ソース/手動入力シグナルを統合し、候補をスコアリングしてInboxへ送る",
        systemNo: 1,
        agentType: "scout",
        scheduleCron: "30 8 * * *",
        concurrencyLimit: 1,
        dailyBudgetUsd: "1",
        monthlyBudgetUsd: "20",
        enabled: true,
        updatedAt: new Date(),
      },
    });
}

export async function bootstrapResearchProducts(
  options: { limit?: number } = {}
): Promise<BootstrapResearchProductsResult> {
  const input = DEFAULT_INPUT;
  const parsed = bundledResearchProducts as ResearchJson;
  const items = (parsed.items ?? []).slice(0, options.limit ?? 100);

  if (items.length === 0) {
    throw new Error(`No items found in ${input}`);
  }

  await ensureScoutAgent();

  const existingProducts = await db.select().from(products);
  const byTitle = new Map<string, Product>();
  for (const product of existingProducts) {
    const key = normalizedTitle(product.title);
    if (!byTitle.has(key)) byTitle.set(key, product);
  }

  const inserts: NewProduct[] = [];
  let updated = 0;
  for (const item of items) {
    const patch = productPatchFor(item, parsed.generatedAt);
    const existing = byTitle.get(normalizedTitle(item.title));

    if (!existing) {
      inserts.push({
        title: item.title,
        sourceAgentId: AGENT_ID,
        stage: "scout",
        status: "pending",
        metadata: patch,
      });
      continue;
    }

    await db
      .update(products)
      .set({
        sourceAgentId: existing.sourceAgentId ?? AGENT_ID,
        stage: "scout",
        status: "pending",
        metadata: deepMerge(asRecord(existing.metadata), patch),
        updatedAt: new Date(),
      })
      .where(eq(products.id, existing.id));
    updated++;
  }

  if (inserts.length > 0) {
    await db.insert(products).values(inserts);
  }

  return {
    input,
    items: items.length,
    imported: updated + inserts.length,
    inserted: inserts.length,
    updated,
    existingOpenApprovals: 0,
  };
}
