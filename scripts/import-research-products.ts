import "./_loadenv";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  enqueueApproval,
  findOrCreateProduct,
  finishRun,
  mergeProductMetadata,
  recordAutoEvaluation,
  startRun,
} from "../src/lib/agent-sdk";
import { closeDb, db } from "../src/lib/db";
import { agents, approvalQueue } from "../src/lib/db/schema";

const AGENT_ID = "scout.scoring";

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

type Args = {
  input: string;
  limit: number | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: "reports/scout-products-2026-06-19.json",
    limit: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input" && next) {
      args.input = next;
      i++;
    }
    if (arg === "--limit" && next) {
      const value = Number(next);
      args.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
      i++;
    }
    if (arg === "--dry-run") args.dryRun = true;
  }

  return args;
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(process.cwd(), path);
}

function requireDatabaseConfig() {
  if (
    !process.env.DATABASE_POOL_URL &&
    !process.env.DATABASE_URL &&
    !process.env.DATABASE_URL_DIRECT
  ) {
    throw new Error(
      "DATABASE_POOL_URL, DATABASE_URL, or DATABASE_URL_DIRECT must be set to import products into the DB. " +
        "Use --dry-run to inspect the import plan without DB writes."
    );
  }
}

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
  const product = await findOrCreateProduct({
    title: item.title,
    sourceAgentId: AGENT_ID,
    stage: "scout",
    status: "pending",
    metadata: {
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
    },
  });

  await mergeProductMetadata(product.id, {
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
  });

  const run = await startRun({
    agentId: AGENT_ID,
    productId: product.id,
    inputPayload: {
      source: "research-products-import",
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
    reasoning: `DB-free shortlist import. ${item.reasons.join(" / ")}. Next: ${item.nextAction}`,
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
    return { productId: product.id, runId: run.id, approvalId: existingOpen.id, reusedApproval: true };
  }

  const approval = await enqueueApproval({
    runId: run.id,
    productId: product.id,
    priority: priorityFor(item.score),
    requiredRole: "reviewer",
  });

  return { productId: product.id, runId: run.id, approvalId: approval.id, reusedApproval: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(abs(args.input), "utf8");
  const parsed = JSON.parse(raw) as ResearchJson;
  const items = (parsed.items ?? []).slice(0, args.limit ?? undefined);
  if (items.length === 0) {
    throw new Error(`No items found in ${args.input}`);
  }

  console.log(`research import: input=${args.input} items=${items.length} dryRun=${args.dryRun}`);
  if (args.dryRun) {
    for (const item of items) {
      console.log(
        `${item.rank}. score=${item.score} priority=${priorityFor(item.score)} ${item.title}`
      );
    }
    return;
  }

  requireDatabaseConfig();
  await ensureScoutAgent();

  let imported = 0;
  let reused = 0;
  for (const item of items) {
    const result = await importItem(item, parsed.generatedAt);
    imported++;
    if (result.reusedApproval) reused++;
    console.log(
      `${item.rank}. imported product=${result.productId} approval=${result.approvalId}` +
        (result.reusedApproval ? " (existing open approval)" : "")
    );
  }

  console.log(`done: imported=${imported} existingOpenApprovals=${reused}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
