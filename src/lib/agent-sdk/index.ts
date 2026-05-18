import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  agents,
  agentPrompts,
  agentRuns,
  agentEvaluations,
  agentSkills,
  approvalQueue,
  products,
  skills,
  type AgentPrompt,
  type NewAgentRun,
  type NewProduct,
  type Skill,
} from "../db/schema";

export type StartRunInput = {
  agentId: string;
  productId?: string | null;
  parentRunId?: string | null;
  promptId?: string | null;
  inputPayload?: Record<string, unknown>;
};

export async function startRun(input: StartRunInput) {
  const values: NewAgentRun = {
    agentId: input.agentId,
    productId: input.productId ?? null,
    parentRunId: input.parentRunId ?? null,
    promptId: input.promptId ?? null,
    status: "running",
    inputPayload: input.inputPayload ?? {},
    startedAt: new Date(),
  };
  const [row] = await db.insert(agentRuns).values(values).returning();
  await db
    .update(agents)
    .set({ lastRunAt: new Date(), lastStatus: "running", updatedAt: new Date() })
    .where(eq(agents.id, input.agentId));
  return row;
}

export type FinishRunInput = {
  runId: string;
  agentId: string;
  outputPayload?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number; // numeric in DB, accept JS number
};

export async function finishRun(input: FinishRunInput) {
  const cost = input.costUsd ?? 0;
  const [row] = await db
    .update(agentRuns)
    .set({
      status: "succeeded",
      outputPayload: input.outputPayload ?? {},
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      costUsd: String(cost),
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, input.runId))
    .returning();

  await db
    .update(agents)
    .set({ lastStatus: "succeeded", updatedAt: new Date() })
    .where(eq(agents.id, input.agentId));

  return row;
}

export async function failRun(input: {
  runId: string;
  agentId: string;
  errorMessage: string;
}) {
  const [row] = await db
    .update(agentRuns)
    .set({
      status: "failed",
      errorMessage: input.errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, input.runId))
    .returning();

  await db
    .update(agents)
    .set({ lastStatus: "failed", updatedAt: new Date() })
    .where(eq(agents.id, input.agentId));

  return row;
}

export async function recordAutoEvaluation(input: {
  runId: string;
  productId?: string | null;
  verdict: "approve" | "reject" | "escalate";
  score?: number;
  reasoning?: string;
  evidence?: Record<string, unknown>;
}) {
  const [row] = await db
    .insert(agentEvaluations)
    .values({
      agentRunId: input.runId,
      productId: input.productId ?? null,
      evaluationType: "auto",
      verdict: input.verdict,
      score: input.score !== undefined ? String(input.score) : null,
      reasoning: input.reasoning ?? null,
      evidence: input.evidence ?? {},
    })
    .returning();
  return row;
}

export async function enqueueApproval(input: {
  runId: string;
  productId?: string | null;
  priority?: number;
  requiredRole?: string;
  slaDeadline?: Date;
}) {
  const [row] = await db
    .insert(approvalQueue)
    .values({
      agentRunId: input.runId,
      productId: input.productId ?? null,
      priority: input.priority ?? 0,
      requiredRole: input.requiredRole ?? "reviewer",
      slaDeadline: input.slaDeadline ?? null,
    })
    .returning();
  return row;
}

export async function upsertProduct(input: NewProduct) {
  const [row] = await db
    .insert(products)
    .values(input)
    .onConflictDoUpdate({
      target: products.id,
      set: {
        title: input.title,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function findProductByAsin(asin: string) {
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.asin, asin))
    .limit(1);
  return row ?? null;
}

/** Find by ASIN if provided, else create. Returns the row. */
export async function findOrCreateProduct(input: NewProduct) {
  if (input.asin) {
    const existing = await findProductByAsin(input.asin);
    if (existing) return existing;
  }
  if (!input.asin) {
    const sourceCondition = input.sourceAgentId
      ? eq(products.sourceAgentId, input.sourceAgentId)
      : isNull(products.sourceAgentId);
    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.title, input.title), sourceCondition))
      .limit(1);
    if (existing) return existing;
  }
  const [row] = await db.insert(products).values(input).returning();
  return row;
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>
): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      cur !== null &&
      typeof cur === "object" &&
      !Array.isArray(cur)
    ) {
      out[k] = deepMerge(
        cur as Record<string, unknown>,
        v as Record<string, unknown>
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** Read products.metadata, deep-merge a patch in, write it back. */
export async function mergeProductMetadata(
  productId: string,
  patch: Record<string, unknown>
) {
  const [current] = await db
    .select({ metadata: products.metadata })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const next = deepMerge(current?.metadata ?? {}, patch);
  const [row] = await db
    .update(products)
    .set({ metadata: next, updatedAt: new Date() })
    .where(eq(products.id, productId))
    .returning();
  return row;
}

export async function setProductStage(
  productId: string,
  stage: NonNullable<NewProduct["stage"]>
) {
  const [row] = await db
    .update(products)
    .set({ stage, updatedAt: new Date() })
    .where(eq(products.id, productId))
    .returning();
  return row;
}

export type RunHandle = Awaited<ReturnType<typeof startRun>>;

/** Get the active prompt for an agent (highest is_active=true), or the latest version if none flagged active. */
export async function getActivePrompt(
  agentId: string
): Promise<AgentPrompt | null> {
  const [active] = await db
    .select()
    .from(agentPrompts)
    .where(and(eq(agentPrompts.agentId, agentId), eq(agentPrompts.isActive, true)))
    .orderBy(desc(agentPrompts.version))
    .limit(1);
  if (active) return active;
  const [latest] = await db
    .select()
    .from(agentPrompts)
    .where(eq(agentPrompts.agentId, agentId))
    .orderBy(desc(agentPrompts.version))
    .limit(1);
  return latest ?? null;
}

export type AttachedSkill = Skill & {
  position: number;
  parameters: Record<string, unknown> | null;
};

/** Skills attached to an agent, ordered by agent_skills.position ASC then name. */
export async function getAttachedSkills(agentId: string): Promise<AttachedSkill[]> {
  const rows = await db
    .select({
      skill: skills,
      position: agentSkills.position,
      parameters: agentSkills.parameters,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(asc(agentSkills.position), asc(skills.name));
  return rows.map((r) => ({
    ...r.skill,
    position: r.position,
    parameters: r.parameters ?? null,
  }));
}

/**
 * Compose the full system prompt for an agent: base prompt + each attached
 * skill's prompt_fragment, joined by blank lines, in position order.
 * If skills is empty, returns the base prompt unchanged.
 */
export function composeSystemPrompt(
  basePrompt: string,
  attached: AttachedSkill[]
): string {
  if (attached.length === 0) return basePrompt;
  const fragments = attached.map((s) => `## Skill: ${s.name}\n${s.promptFragment}`);
  return [basePrompt.trim(), ...fragments].join("\n\n");
}

export type CreatePromptInput = {
  agentId: string;
  systemPrompt: string;
  userTemplate?: string | null;
  model?: string | null;
  parameters?: Record<string, unknown>;
  notes?: string | null;
  createdBy?: string | null;
  /** If true, mark this version as active and deactivate others. */
  activate?: boolean;
};

/** Create a new prompt version (auto-incremented). Optionally make it active. */
export async function createPromptVersion(input: CreatePromptInput) {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ v: agentPrompts.version })
      .from(agentPrompts)
      .where(eq(agentPrompts.agentId, input.agentId))
      .orderBy(desc(agentPrompts.version))
      .limit(1);
    const nextVersion = (latest?.v ?? 0) + 1;

    if (input.activate) {
      await tx
        .update(agentPrompts)
        .set({ isActive: false })
        .where(eq(agentPrompts.agentId, input.agentId));
    }

    const [row] = await tx
      .insert(agentPrompts)
      .values({
        agentId: input.agentId,
        version: nextVersion,
        systemPrompt: input.systemPrompt,
        userTemplate: input.userTemplate ?? null,
        model: input.model ?? null,
        parameters: input.parameters ?? {},
        isActive: input.activate ?? false,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      })
      .returning();
    return row;
  });
}
