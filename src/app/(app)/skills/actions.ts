"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { skills, agentSkills } from "@/lib/db/schema";
import { SKILL_CATEGORIES } from "./constants";

const SkillSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(80)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "slug は 小文字英数 + アンダースコア で指定してください"
    ),
  category: z.enum(SKILL_CATEGORIES),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  promptFragment: z.string().min(1),
  parametersSchemaJson: z.string().optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };
export type SkillFormInput = z.input<typeof SkillSchema>;

function parseParamsSchema(json: string | undefined): {
  ok: true;
  value: Record<string, unknown>;
} | { ok: false; error: string } {
  if (!json || !json.trim()) return { ok: true, value: {} };
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, error: "parameters_schema は JSON オブジェクトで指定してください" };
    }
    return { ok: true, value: obj as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: "parameters_schema の JSON が不正です: " + (err as Error).message };
  }
}

export async function createSkill(
  raw: SkillFormInput
): Promise<ActionResult & { skillId?: string }> {
  let parsed: z.infer<typeof SkillSchema>;
  try {
    parsed = SkillSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues.map((i) => i.message).join("; ") };
    }
    return { ok: false, error: (err as Error).message };
  }

  const params = parseParamsSchema(parsed.parametersSchemaJson);
  if (!params.ok) return params;

  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const existing = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, parsed.slug))
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, error: `slug "${parsed.slug}" は既に使われています` };
  }

  const [row] = await db
    .insert(skills)
    .values({
      slug: parsed.slug,
      category: parsed.category,
      name: parsed.name,
      description: parsed.description ?? null,
      promptFragment: parsed.promptFragment,
      parametersSchema: params.value,
    })
    .returning({ id: skills.id });

  revalidatePath("/skills");
  redirect(`/skills/${row.id}`);
}

export async function updateSkill(
  skillId: string,
  raw: SkillFormInput
): Promise<ActionResult> {
  let parsed: z.infer<typeof SkillSchema>;
  try {
    parsed = SkillSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues.map((i) => i.message).join("; ") };
    }
    return { ok: false, error: (err as Error).message };
  }

  const params = parseParamsSchema(parsed.parametersSchemaJson);
  if (!params.ok) return params;

  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Slug must remain unique across other rows.
  const conflict = await db
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, parsed.slug))
    .limit(1);
  if (conflict.length > 0 && conflict[0].id !== skillId) {
    return { ok: false, error: `slug "${parsed.slug}" は他のスキルで使われています` };
  }

  await db
    .update(skills)
    .set({
      slug: parsed.slug,
      category: parsed.category,
      name: parsed.name,
      description: parsed.description ?? null,
      promptFragment: parsed.promptFragment,
      parametersSchema: params.value,
      updatedAt: new Date(),
    })
    .where(eq(skills.id, skillId));

  revalidatePath("/skills");
  revalidatePath(`/skills/${skillId}`);
  // Any agent that has this skill attached needs its detail page refreshed.
  revalidatePath("/agents", "layout");
  return { ok: true };
}

export async function deleteSkill(skillId: string): Promise<ActionResult> {
  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  // FK ON DELETE CASCADE removes agent_skills rows automatically.
  await db.delete(skills).where(eq(skills.id, skillId));
  revalidatePath("/skills");
  revalidatePath("/agents", "layout");
  return { ok: true };
}

// ---------- agent_skills attach/detach/reorder ----------

export async function attachSkill(input: {
  agentId: string;
  skillId: string;
}): Promise<ActionResult> {
  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Position = max(existing) + 1, so newly attached skills land at the end.
  const existing = await db
    .select({ position: agentSkills.position })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, input.agentId));
  const nextPosition =
    existing.length === 0
      ? 0
      : Math.max(...existing.map((r) => r.position)) + 1;

  try {
    await db.insert(agentSkills).values({
      agentId: input.agentId,
      skillId: input.skillId,
      position: nextPosition,
    });
  } catch (err) {
    // Unique violation = already attached. Treat as a benign no-op.
    const msg = (err as Error).message ?? "";
    if (!msg.includes("duplicate") && !msg.includes("unique")) {
      return { ok: false, error: msg };
    }
  }

  revalidatePath(`/agents/${input.agentId}`);
  return { ok: true };
}

export async function detachSkill(input: {
  agentId: string;
  skillId: string;
}): Promise<ActionResult> {
  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  await db
    .delete(agentSkills)
    .where(
      and(
        eq(agentSkills.agentId, input.agentId),
        eq(agentSkills.skillId, input.skillId)
      )
    );
  revalidatePath(`/agents/${input.agentId}`);
  return { ok: true };
}

/**
 * Replace the full ordered list of skills for an agent in one call.
 * Idempotent. Used by the drag-reorder UI.
 */
export async function reorderAgentSkills(input: {
  agentId: string;
  skillIdsInOrder: string[];
}): Promise<ActionResult> {
  try {
    await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.skillIdsInOrder.length; i++) {
      const skillId = input.skillIdsInOrder[i];
      await tx
        .update(agentSkills)
        .set({ position: i })
        .where(
          and(
            eq(agentSkills.agentId, input.agentId),
            eq(agentSkills.skillId, skillId)
          )
        );
    }
  });

  revalidatePath(`/agents/${input.agentId}`);
  return { ok: true };
}
