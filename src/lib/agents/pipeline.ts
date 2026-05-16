import { eq } from "drizzle-orm";
import { db } from "../db";
import { products } from "../db/schema";
import { enqueueApproval, setProductStage } from "../agent-sdk";
import { runCopyWriter } from "./lp-copy-writer";
import { runComplianceCheck } from "./lp-compliance";
import { runFaqGenerator } from "./lp-faq";
import { runImageCurator } from "./lp-image";
import { runAdHeadlineWriter } from "./ad-headline";
import { runOutreachDrafter } from "./outreach-message";
import { runCsDrafter } from "./cs-response";

export type AdvanceResult = {
  fromStage: string;
  toStage: string;
  newApprovalId: string | null;
  message: string;
};

/**
 * Advance a product to the next pipeline stage by running the agents
 * responsible for that stage. Called after a human approval lands on a
 * product. No-op for products at "archived".
 */
export async function advancePipeline(productId: string): Promise<AdvanceResult> {
  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product) throw new Error(`product ${productId} not found`);

  const fromStage = product.stage;

  if (fromStage === "scout") {
    const copy = await runCopyWriter(productId);
    await runComplianceCheck(productId, copy.runId);
    await runFaqGenerator(productId, copy.runId);
    await runImageCurator(productId, copy.runId);
    await setProductStage(productId, "lp");

    // priority from compliance risk level
    const [updated] = await db
      .select({ metadata: products.metadata })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const meta = (updated?.metadata ?? {}) as {
      lp?: { compliance?: { riskLevel?: "low" | "medium" | "high" } };
    };
    const risk = meta.lp?.compliance?.riskLevel;
    const priority = risk === "high" ? 7 : risk === "medium" ? 4 : 2;

    const item = await enqueueApproval({
      runId: copy.runId,
      productId,
      priority,
      requiredRole: "reviewer",
    });
    return {
      fromStage,
      toStage: "lp",
      newApprovalId: item.id,
      message: `LPコピー・FAQ・画像案・コンプラチェック完了 (risk=${risk ?? "unknown"})。LP承認待ち。`,
    };
  }

  if (fromStage === "lp") {
    const ad = await runAdHeadlineWriter(productId);
    await setProductStage(productId, "ad");
    const item = await enqueueApproval({
      runId: ad.runId,
      productId,
      priority: 2,
      requiredRole: "reviewer",
    });
    return {
      fromStage,
      toStage: "ad",
      newApprovalId: item.id,
      message: "広告見出し生成完了。広告承認待ち。",
    };
  }

  if (fromStage === "ad") {
    const out = await runOutreachDrafter(productId);
    await setProductStage(productId, "outreach");
    const item = await enqueueApproval({
      runId: out.runId,
      productId,
      priority: 2,
      requiredRole: "reviewer",
    });
    return {
      fromStage,
      toStage: "outreach",
      newApprovalId: item.id,
      message: "仕入れ連絡文面ドラフト完了。Outreach承認待ち。",
    };
  }

  if (fromStage === "outreach") {
    const cs = await runCsDrafter(productId);
    await setProductStage(productId, "cs");
    const item = await enqueueApproval({
      runId: cs.runId,
      productId,
      priority: 2,
      requiredRole: "reviewer",
    });
    return {
      fromStage,
      toStage: "cs",
      newApprovalId: item.id,
      message: "CS応対テンプレ生成完了。CS承認待ち。",
    };
  }

  if (fromStage === "cs") {
    await setProductStage(productId, "archived");
    return {
      fromStage,
      toStage: "archived",
      newApprovalId: null,
      message: "全工程完了。アーカイブに移動しました。",
    };
  }

  return {
    fromStage,
    toStage: fromStage,
    newApprovalId: null,
    message: "次の段階は定義されていません。",
  };
}
