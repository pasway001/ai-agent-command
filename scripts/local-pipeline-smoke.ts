import "./_loadenv";
import { eq, inArray } from "drizzle-orm";
import { closeDb, db } from "../src/lib/db";
import { agentRuns, agents, approvalQueue, products } from "../src/lib/db/schema";
import { advancePipeline } from "../src/lib/agents/pipeline";

process.env.LLM_PROVIDER = "mock";

const REQUIRED_AGENTS = [
  "scout.scoring",
  "lp.copy_writer",
  "lp.compliance_check",
  "lp.faq_generator",
  "lp.image_curator",
] as const;

function keepRows() {
  return process.argv.includes("--keep");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ensureAgents() {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(inArray(agents.id, [...REQUIRED_AGENTS]));
  const present = new Set(rows.map((row) => row.id));
  const missing = REQUIRED_AGENTS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Missing required local pipeline agents: ${missing.join(", ")}. Run pnpm db:seed-minimal.`
    );
  }
}

async function createSmokeProduct() {
  const title = `[SMOKE] Local Sales Pipeline ${new Date().toISOString()}`;
  const [product] = await db
    .insert(products)
    .values({
      title,
      sourceAgentId: "scout.scoring",
      stage: "scout",
      status: "approved",
      metadata: {
        signals: {
          title,
          productType: "physical",
          physicalProductLikely: true,
          category: "local pipeline smoke",
          overseas: {
            source: "local-smoke",
            url: "https://example.com/local-smoke-product",
            description: "Temporary smoke-test product for local sales pipeline verification.",
          },
          japan: {
            searchSummary: "Makuakeで先行販売訴求を検証",
            japanValidationLevel: 0.3,
          },
          mentionSources: ["local-smoke"],
          crossSourceScore: 0.2,
        },
        salesReadiness: {
          priority: 1,
          reasons: ["ローカル販売パイプライン検証用"],
          risks: ["検証後に削除"],
          nextAction: "LP生成から承認待ち作成までを確認",
        },
      },
    })
    .returning();
  return product;
}

async function cleanup(productId: string) {
  await db.delete(approvalQueue).where(eq(approvalQueue.productId, productId));
  await db.delete(agentRuns).where(eq(agentRuns.productId, productId));
  await db.delete(products).where(eq(products.id, productId));
}

async function main() {
  await ensureAgents();
  const product = await createSmokeProduct();

  try {
    const result = await advancePipeline(product.id);
    const [updated] = await db
      .select({
        stage: products.stage,
        status: products.status,
        metadata: products.metadata,
      })
      .from(products)
      .where(eq(products.id, product.id))
      .limit(1);
    const approvals = await db
      .select({ id: approvalQueue.id })
      .from(approvalQueue)
      .where(eq(approvalQueue.productId, product.id));

    const metadata = (updated?.metadata ?? {}) as {
      lp?: {
        copy?: { headline?: string };
        compliance?: { riskLevel?: string };
        faqs?: unknown[];
        images?: unknown[];
      };
    };

    assert(result.fromStage === "scout", "expected fromStage=scout");
    assert(result.toStage === "lp", "expected toStage=lp");
    assert(updated?.stage === "lp", "product did not advance to lp");
    assert(updated.status === "approved", "product status should stay approved");
    assert(metadata.lp?.copy?.headline, "LP copy headline was not generated");
    assert(metadata.lp?.compliance?.riskLevel, "LP compliance result was not generated");
    assert((metadata.lp?.faqs?.length ?? 0) >= 3, "LP FAQs were not generated");
    assert((metadata.lp?.images?.length ?? 0) === 4, "LP image concepts were not generated");
    assert(approvals.length === 1, "LP approval queue item was not created");

    console.log(
      JSON.stringify(
        {
          ok: true,
          productId: product.id,
          title: product.title,
          result,
          lp: {
            headline: metadata.lp.copy.headline,
            riskLevel: metadata.lp.compliance.riskLevel,
            faqCount: metadata.lp.faqs?.length ?? 0,
            imageCount: metadata.lp.images?.length ?? 0,
          },
          cleanup: keepRows() ? "kept" : "deleted",
        },
        null,
        2
      )
    );
  } finally {
    if (!keepRows()) {
      await cleanup(product.id);
    }
    await closeDb();
  }
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
