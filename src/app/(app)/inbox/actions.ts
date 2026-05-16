"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, or } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  approvalQueue,
  products,
  agentEvaluations,
} from "@/lib/db/schema";
import { advancePipeline } from "@/lib/agents/pipeline";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証されていません");
  return user;
}

export type ActionResult =
  | { ok: true; nextStage?: string; pipelineMessage?: string }
  | { ok: false; error: string };

export async function claimItem(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
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
      return { ok: false, error: "他のレビュアーがすでにクレーム済みです" };
    }
    revalidatePath("/inbox");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function releaseItem(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
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
    const user = await requireUser();

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

    let pipelineMessage: string | undefined;
    let nextStage: string | undefined;
    if (approvedProductId) {
      try {
        const result = await advancePipeline(approvedProductId);
        pipelineMessage = result.message;
        nextStage = result.toStage;
      } catch (err) {
        pipelineMessage = `次工程の自動起動に失敗: ${(err as Error).message}`;
      }
    }

    revalidatePath("/inbox");
    revalidatePath("/pipeline");
    return { ok: true, nextStage, pipelineMessage };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
