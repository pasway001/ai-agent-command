"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import { createPromptVersion } from "@/lib/agent-sdk";
import { runDbAgent } from "@/lib/agents/_db-agent";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証されていません");
  return user;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function savePromptVersion(input: {
  agentId: string;
  systemPrompt: string;
  notes?: string;
  activate: boolean;
}): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmed = input.systemPrompt.trim();
    if (!trimmed) {
      return { ok: false, error: "プロンプトが空です" };
    }
    await createPromptVersion({
      agentId: input.agentId,
      systemPrompt: trimmed,
      notes: input.notes?.trim() || null,
      activate: input.activate,
      createdBy: user.id,
    });
    revalidatePath(`/agents/${input.agentId}`);
    revalidatePath(`/agents`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export type TestRunResult =
  | { ok: true; runId: string; output: Record<string, unknown> }
  | { ok: false; error: string };

export async function testRunDynamicAgent(input: {
  agentId: string;
  inputJson: string;
}): Promise<TestRunResult> {
  try {
    await requireUser();
    let parsed: Record<string, unknown> = {};
    if (input.inputJson.trim()) {
      const obj = JSON.parse(input.inputJson);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return { ok: false, error: "input は JSON オブジェクトで指定してください" };
      }
      parsed = obj as Record<string, unknown>;
    }
    const res = await runDbAgent({ agentId: input.agentId, input: parsed });
    revalidatePath(`/agents/${input.agentId}`);
    revalidatePath("/runs");
    return { ok: true, runId: res.runId, output: res.output };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function activatePromptVersion(input: {
  agentId: string;
  promptId: string;
}): Promise<ActionResult> {
  try {
    await requireUser();
    await db.transaction(async (tx) => {
      await tx
        .update(agentPrompts)
        .set({ isActive: false })
        .where(eq(agentPrompts.agentId, input.agentId));
      await tx
        .update(agentPrompts)
        .set({ isActive: true })
        .where(eq(agentPrompts.id, input.promptId));
    });
    revalidatePath(`/agents/${input.agentId}`);
    revalidatePath(`/agents`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
