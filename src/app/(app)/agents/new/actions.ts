"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { agents } from "@/lib/db/schema";
import { createPromptVersion } from "@/lib/agent-sdk";

const AGENT_TYPES = ["scout", "lp", "ad", "outreach", "cs"] as const;
const SYSTEM_NO_BY_TYPE: Record<(typeof AGENT_TYPES)[number], number> = {
  scout: 1,
  lp: 2,
  ad: 3,
  outreach: 4,
  cs: 5,
};

const CreateAgentSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(80)
    .regex(
      /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
      "ID は <system>.<slug> の形式（小文字英数 + アンダースコア）で指定してください"
    ),
  name: z.string().min(1).max(120),
  agentType: z.enum(AGENT_TYPES),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().optional(),
  model: z.string().max(80).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(32000).optional(),
  signalKey: z
    .string()
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "signal_key は英字から始まる識別子で")
    .optional(),
  outputSchemaJson: z.string().optional(),
});

export type CreateAgentInput = z.input<typeof CreateAgentSchema>;
export type CreateAgentResult =
  | { ok: true; agentId: string }
  | { ok: false; error: string };

export async function createAgent(
  raw: CreateAgentInput
): Promise<CreateAgentResult> {
  let parsed: z.infer<typeof CreateAgentSchema>;
  try {
    parsed = CreateAgentSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues.map((i) => i.message).join("; ") };
    }
    return { ok: false, error: (err as Error).message };
  }

  // Output schema is optional; when provided it must be a JSON object.
  let outputSchema: Record<string, unknown> | null = null;
  if (parsed.outputSchemaJson && parsed.outputSchemaJson.trim()) {
    try {
      const obj = JSON.parse(parsed.outputSchemaJson);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        return { ok: false, error: "出力スキーマは JSON オブジェクトで指定してください" };
      }
      outputSchema = obj as Record<string, unknown>;
    } catch (err) {
      return { ok: false, error: "出力スキーマの JSON が不正です: " + (err as Error).message };
    }
  }

  // Enforce id namespace matches the agent type so we don't get
  // surprises like a "lp.foo" agent assigned to scout.
  const [namespace] = parsed.id.split(".");
  if (namespace !== parsed.agentType) {
    return {
      ok: false,
      error: `ID の名前空間 "${namespace}" は agentType "${parsed.agentType}" と一致させてください`,
    };
  }

  let user: { id: string };
  try {
    user = await requireCurrentUser();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, parsed.id))
    .limit(1);
  if (existing.length > 0) {
    return { ok: false, error: `Agent ID "${parsed.id}" は既に存在します` };
  }

  await db.transaction(async (tx) => {
    await tx.insert(agents).values({
      id: parsed.id,
      name: parsed.name,
      systemNo: SYSTEM_NO_BY_TYPE[parsed.agentType],
      agentType: parsed.agentType,
      description: parsed.description ?? null,
      isDynamic: true,
      userPromptTemplate: parsed.userPromptTemplate?.trim() || null,
      outputSchema,
      signalKey: parsed.signalKey ?? null,
    });
  });

  // Create v1 prompt outside the transaction since createPromptVersion runs
  // its own transaction and we don't want a nested one.
  const parameters: Record<string, unknown> = {};
  if (parsed.temperature !== undefined) parameters.temperature = parsed.temperature;
  if (parsed.maxTokens !== undefined) parameters.maxTokens = parsed.maxTokens;

  await createPromptVersion({
    agentId: parsed.id,
    systemPrompt: parsed.systemPrompt.trim(),
    model: parsed.model?.trim() || "mock",
    parameters,
    notes: "v1: UI から作成",
    activate: true,
    createdBy: user.id,
  });

  revalidatePath("/agents");
  revalidatePath(`/agents/${parsed.id}`);
  redirect(`/agents/${encodeURIComponent(parsed.id)}`);
}
