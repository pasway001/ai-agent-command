import { and, eq, isNull } from "drizzle-orm";
import bundledResearchProducts from "../../../reports/scout-products-2026-06-19.json";
import {
  enqueueApproval,
  findOrCreateProduct,
  finishRun,
  mergeProductMetadata,
  recordAutoEvaluation,
  startRun,
} from "../agent-sdk";
import { db } from "../db";
import { agents, approvalQueue, products } from "../db/schema";

const AGENT_ID = "scout.scoring";
const DEFAULT_INPUT = "reports/scout-products-2026-06-19.json";

type ResearchJson = {
  generatedAt?: string;
  items?: ResearchItem[];
};

type ResearchItem = {
  rank: number;
  title: string;
  source: string;
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
  existingOpenApprovals: number;
};

function priorityFor(score: number) {
  if (score >= 90) return 9;
  if (score >= 84) return 7;
  if (score >= 80) return 5;
  return 3;
}

function verdictFor(score: number): "approve" | "escalate" {
  return score >= 84 ? "approve" : "escalate";
}

function signalsFor(item: ResearchItem) {
  return {
    title: item.title,
    category: `${item.source} shortlist rank ${item.rank}`,
    productType: "physical" as const,
    physicalProductLikely: true,
    overseas: {
      source: item.source,
      url: item.url || undefined,
      description: item.description,
      publishedAt: item.publishedAt ?? undefined,
    },
    japan: {
      notYetInJapan: undefined,
      searchSummary: item.japanAngle,
      japanValidationLevel: 0.3,
    },
    mentionSources: [item.source],
    crossSourceScore: 0.2,
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

async function importItem(item: ResearchItem, generatedAt: string | undefined) {
  const signals = signalsFor(item);
  const salesReadiness = {
    sourceReportGeneratedAt: generatedAt ?? null,
    importedAt: new Date().toISOString(),
    priority: priorityFor(item.score),
    nextAction: item.nextAction,
    risks: item.risks,
    reasons: item.reasons,
  };
  const product = await findOrCreateProduct({
    title: item.title,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: {
      signals,
      shortlist: item,
      salesReadiness,
    },
  });

  await mergeProductMetadata(product.id, {
    signals,
    shortlist: item,
    salesReadiness,
  });

  await db
    .update(products)
    .set({
      stage: "scout",
      status: "pending",
      updatedAt: new Date(),
    })
    .where(eq(products.id, product.id));

  const [existingOpen] = await db
    .select({ id: approvalQueue.id })
    .from(approvalQueue)
    .where(
      and(
        eq(approvalQueue.productId, product.id),
        isNull(approvalQueue.decision)
      )
    )
    .limit(1);

  if (existingOpen) {
    return { reusedApproval: true };
  }

  const run = await startRun({
    agentId: AGENT_ID,
    productId: product.id,
    inputPayload: {
      source: "maintenance-bootstrap",
      shortlistItem: item,
      signals,
    },
  });

  const verdict = verdictFor(item.score);
  await recordAutoEvaluation({
    runId: run.id,
    productId: product.id,
    verdict,
    score: item.score / 100,
    reasoning: `Bundled shortlist bootstrap. ${item.reasons.join(" / ")}. Next: ${item.nextAction}`,
    evidence: {
      source: item.source,
      url: item.url,
      risks: item.risks,
      japanAngle: item.japanAngle,
      rank: item.rank,
    },
  });

  await finishRun({
    runId: run.id,
    agentId: AGENT_ID,
    outputPayload: {
      verdict,
      score: item.score / 100,
      shortlistItem: item,
      imported: true,
    },
  });

  await enqueueApproval({
    runId: run.id,
    productId: product.id,
    priority: priorityFor(item.score),
    requiredRole: "reviewer",
  });

  return { reusedApproval: false };
}

export async function bootstrapResearchProducts(
  options: { limit?: number } = {}
): Promise<BootstrapResearchProductsResult> {
  const input = DEFAULT_INPUT;
  const parsed = bundledResearchProducts as ResearchJson;
  const items = (parsed.items ?? []).slice(0, options.limit ?? 30);

  if (items.length === 0) {
    throw new Error(`No items found in ${input}`);
  }

  await ensureScoutAgent();

  let imported = 0;
  let existingOpenApprovals = 0;
  for (const item of items) {
    const result = await importItem(item, parsed.generatedAt);
    imported++;
    if (result.reusedApproval) existingOpenApprovals++;
  }

  return {
    input,
    items: items.length,
    imported,
    existingOpenApprovals,
  };
}
