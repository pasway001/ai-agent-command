"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import {
  approvalQueue,
  products,
  agentEvaluations,
} from "@/lib/db/schema";
import { mergeProductMetadata } from "@/lib/agent-sdk";
import { advancePipeline } from "@/lib/agents/pipeline";

export type ActionResult =
  | { ok: true; pipelineMessage?: string }
  | { ok: false; error: string };

export async function claimItem(id: string): Promise<ActionResult> {
  try {
    const user = await requireCurrentUser();
    const [updated] = await db
      .update(approvalQueue)
      .set({ assignedTo: user.id, claimedAt: new Date() })
      .where(
        and(
          eq(approvalQueue.id, id),
          isNull(approvalQueue.assignedTo),
          isNull(approvalQueue.decision)
        )
      )
      .returning();
    if (!updated) {
      return { ok: false, error: "他のレビュアーがすでに担当済みです" };
    }
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function releaseItem(id: string): Promise<ActionResult> {
  try {
    const user = await requireCurrentUser();
    await db
      .update(approvalQueue)
      .set({ assignedTo: null, claimedAt: null })
      .where(
        and(
          eq(approvalQueue.id, id),
          eq(approvalQueue.assignedTo, user.id),
          isNull(approvalQueue.decision)
        )
      );
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function decideItem(input: {
  id: string;
  decision: "approve" | "reject";
  note?: string;
}): Promise<ActionResult> {
  let approvedProductId: string | null = null;

  try {
    const user = await requireCurrentUser();

    await db.transaction(async (tx) => {
      const [item] = await tx
        .update(approvalQueue)
        .set({
          assignedTo: user.id,
          claimedAt: new Date(),
          decision: input.decision,
          decidedAt: new Date(),
          decidedBy: user.id,
          decisionNote: input.note ?? null,
        })
        .where(
          and(
            eq(approvalQueue.id, input.id),
            isNull(approvalQueue.decision),
            or(isNull(approvalQueue.assignedTo), eq(approvalQueue.assignedTo, user.id))
          )
        )
        .returning({
          productId: approvalQueue.productId,
          agentRunId: approvalQueue.agentRunId,
        });

      if (!item) {
        const [current] = await tx
          .select({
            assignedTo: approvalQueue.assignedTo,
            decision: approvalQueue.decision,
          })
          .from(approvalQueue)
          .where(eq(approvalQueue.id, input.id))
          .limit(1);

        if (!current) throw new Error("対象の承認が見つかりません");
        if (current.decision) throw new Error("すでに判定済みです");
        if (current.assignedTo && current.assignedTo !== user.id) {
          throw new Error("他のレビュアーが担当中です");
        }
        throw new Error("承認状態が更新できませんでした");
      }

      if (item.productId) {
        await tx
          .update(products)
          .set({
            status: input.decision === "approve" ? "approved" : "rejected",
            updatedAt: new Date(),
          })
          .where(eq(products.id, item.productId));

        if (input.decision === "approve") {
          approvedProductId = item.productId;
        }
      }

      await tx.insert(agentEvaluations).values({
        agentRunId: item.agentRunId,
        productId: item.productId,
        evaluationType: "human",
        verdict: input.decision,
        evaluatorId: user.id,
        reasoning: input.note ?? null,
      });
    });

    revalidatePath("/inbox");
    revalidatePath("/pipeline");

    let pipelineMessage: string | undefined;
    if (approvedProductId) {
      const productId = approvedProductId;
      // Advancing a stage runs several LLM-backed agents in sequence, which
      // can take a long time and occasionally fails. Run it after this
      // response is sent so the approval itself never hangs or reads as
      // failed just because downstream automation did. `after()` (not a
      // bare fire-and-forget) is required so hosts that freeze the function
      // once the response is flushed still let this finish.
      await mergeProductMetadata(productId, {
        pipelineAutomation: {
          status: "running",
          stage: null,
          message: "次工程を自動実行中です…",
          updatedAt: new Date().toISOString(),
        },
      });
      after(async () => {
        try {
          const result = await advancePipeline(productId);
          await mergeProductMetadata(productId, {
            pipelineAutomation: {
              status: "ok",
              stage: result.toStage,
              message: result.message,
              updatedAt: new Date().toISOString(),
            },
          });
        } catch (err) {
          console.error("[advancePipeline] failed", err);
          await mergeProductMetadata(productId, {
            pipelineAutomation: {
              status: "failed",
              stage: null,
              message: (err as Error).message,
              updatedAt: new Date().toISOString(),
            },
          }).catch(() => {});
        } finally {
          revalidatePath("/inbox");
          revalidatePath("/pipeline");
          revalidatePath("/approved");
        }
      });
      pipelineMessage =
        "次工程を自動実行中です。完了すると「承認済み」一覧に反映されます。";
    }

    return { ok: true, pipelineMessage };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
