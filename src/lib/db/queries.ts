import { and, asc, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  agents,
  agentPrompts,
  agentRuns,
  agentSkills,
  approvalQueue,
  products,
  skills,
  type Agent,
  type Product,
  type Skill,
} from "./schema";

export async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("[db query failed]", err);
    return null;
  }
}

export async function getOpenApprovals() {
  return db
    .select({
      id: approvalQueue.id,
      priority: approvalQueue.priority,
      assignedTo: approvalQueue.assignedTo,
      claimedAt: approvalQueue.claimedAt,
      slaDeadline: approvalQueue.slaDeadline,
      createdAt: approvalQueue.createdAt,
      productId: products.id,
      productTitle: products.title,
      productStage: products.stage,
      agentId: agentRuns.agentId,
      runId: agentRuns.id,
    })
    .from(approvalQueue)
    .leftJoin(agentRuns, eq(approvalQueue.agentRunId, agentRuns.id))
    .leftJoin(products, eq(approvalQueue.productId, products.id))
    .where(isNull(approvalQueue.decision))
    .orderBy(desc(approvalQueue.priority), approvalQueue.createdAt);
}

export type OpenApproval = Awaited<ReturnType<typeof getOpenApprovals>>[number];

export async function getOpenApprovalsCount(): Promise<number> {
  const [row] = await db
    .select({ c: count() })
    .from(approvalQueue)
    .where(isNull(approvalQueue.decision));
  return Number(row?.c ?? 0);
}

export async function getProductsByStage() {
  const rows = await db
    .select({
      stage: products.stage,
      product: products,
    })
    .from(products)
    .orderBy(desc(products.updatedAt));

  const grouped: Record<Product["stage"], Product[]> = {
    scout: [],
    lp: [],
    ad: [],
    outreach: [],
    cs: [],
    archived: [],
  };
  for (const row of rows) {
    grouped[row.stage].push(row.product);
  }
  return grouped;
}

export async function getAgentsWithStats() {
  // Last 24h run counts per agent
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentRuns = await db
    .select({
      agentId: agentRuns.agentId,
      total: count(),
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(agentRuns)
    .where(gte(agentRuns.createdAt, since))
    .groupBy(agentRuns.agentId);

  // 30-day quality metrics: auto-human agreement, human reject rate, avg latency.
  // Pair each run with its auto verdict and human verdict (if any).
  const qualityRows = await db.execute<{
    agent_id: string;
    reviewed: number;
    agreement: number | null;
    human_reject_rate: number | null;
    avg_latency_ms: number | null;
  }>(sql`
    with paired as (
      select
        ar.agent_id,
        ar.id as run_id,
        case
          when ar.finished_at is not null and ar.started_at is not null
          then extract(epoch from (ar.finished_at - ar.started_at)) * 1000
        end as latency_ms,
        max(case when ae.evaluation_type = 'auto'  then ae.verdict::text end) as auto_verdict,
        max(case when ae.evaluation_type = 'human' then ae.verdict::text end) as human_verdict
      from agent_runs ar
      left join agent_evaluations ae on ae.agent_run_id = ar.id
      where ar.created_at >= now() - interval '30 days'
      group by ar.agent_id, ar.id, ar.started_at, ar.finished_at
    )
    select
      agent_id,
      count(*) filter (where human_verdict is not null)::int as reviewed,
      avg((auto_verdict = human_verdict)::int)
        filter (where auto_verdict is not null and human_verdict is not null)
        as agreement,
      avg((human_verdict = 'reject')::int)
        filter (where human_verdict is not null)
        as human_reject_rate,
      avg(latency_ms) as avg_latency_ms
    from paired
    group by agent_id
  `);

  const allAgents = await db
    .select()
    .from(agents)
    .orderBy(agents.systemNo, agents.id);

  const statsByAgent = new Map(recentRuns.map((r) => [r.agentId, r]));
  const qualityByAgent = new Map(qualityRows.map((r) => [r.agent_id, r]));
  return allAgents.map((a: Agent) => {
    const q = qualityByAgent.get(a.id);
    return {
      ...a,
      runs24h: statsByAgent.get(a.id)?.total ?? 0,
      failures24h: statsByAgent.get(a.id)?.failed ?? 0,
      reviewed30d: q?.reviewed ?? 0,
      agreement30d:
        q?.agreement !== null && q?.agreement !== undefined
          ? Number(q.agreement)
          : null,
      humanRejectRate30d:
        q?.human_reject_rate !== null && q?.human_reject_rate !== undefined
          ? Number(q.human_reject_rate)
          : null,
      avgLatencyMs30d:
        q?.avg_latency_ms !== null && q?.avg_latency_ms !== undefined
          ? Number(q.avg_latency_ms)
          : null,
    };
  });
}

export async function getRecentRuns(limit = 50) {
  return db
    .select({
      id: agentRuns.id,
      agentId: agentRuns.agentId,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      finishedAt: agentRuns.finishedAt,
      tokensIn: agentRuns.tokensIn,
      tokensOut: agentRuns.tokensOut,
      costUsd: agentRuns.costUsd,
      errorMessage: agentRuns.errorMessage,
      productTitle: products.title,
    })
    .from(agentRuns)
    .leftJoin(products, eq(agentRuns.productId, products.id))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
}

export async function getCostSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const rows = await db
    .select({
      agentId: agentRuns.agentId,
      createdAt: agentRuns.createdAt,
      costUsd: agentRuns.costUsd,
      tokensIn: agentRuns.tokensIn,
      tokensOut: agentRuns.tokensOut,
    })
    .from(agentRuns)
    .where(gte(agentRuns.createdAt, monthStart));

  const allAgents = await db.select().from(agents);
  const agentMeta = new Map(allAgents.map((a) => [a.id, a]));

  const grouped = new Map<
    string,
    {
      agentId: string;
      agentName: string;
      systemNo: number;
      todayUsd: number;
      monthUsd: number;
      tokensInMonth: number;
      tokensOutMonth: number;
      totalRuns: number;
    }
  >();

  for (const row of rows) {
    const meta = agentMeta.get(row.agentId);
    const current =
      grouped.get(row.agentId) ??
      {
        agentId: row.agentId,
        agentName: meta?.name ?? row.agentId,
        systemNo: meta?.systemNo ?? 0,
        todayUsd: 0,
        monthUsd: 0,
        tokensInMonth: 0,
        tokensOutMonth: 0,
        totalRuns: 0,
      };
    const cost = Number(row.costUsd);

    current.monthUsd += cost;
    current.tokensInMonth += row.tokensIn;
    current.tokensOutMonth += row.tokensOut;
    current.totalRuns += 1;
    if (row.createdAt >= today) {
      current.todayUsd += cost;
    }

    grouped.set(row.agentId, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) =>
      a.systemNo !== b.systemNo
        ? a.systemNo - b.systemNo
        : a.agentId.localeCompare(b.agentId)
    )
    .map((row) => ({
      agentId: row.agentId,
      agentName: row.agentName,
      systemNo: row.systemNo,
      todayUsd: row.todayUsd.toFixed(6),
      monthUsd: row.monthUsd.toFixed(6),
      tokensInMonth: row.tokensInMonth,
      tokensOutMonth: row.tokensOutMonth,
      totalRuns: row.totalRuns,
    }));
}

export async function claimApprovalItem(id: string, userId: string) {
  const [updated] = await db
    .update(approvalQueue)
    .set({ assignedTo: userId, claimedAt: new Date() })
    .where(
      and(
        eq(approvalQueue.id, id),
        isNull(approvalQueue.assignedTo),
        isNull(approvalQueue.decision)
      )
    )
    .returning();
  return updated ?? null;
}

export async function decideApproval(
  id: string,
  decision: "approve" | "reject",
  userId: string,
  note?: string
) {
  return db
    .update(approvalQueue)
    .set({
      decision,
      decidedAt: new Date(),
      decidedBy: userId,
      decisionNote: note,
    })
    .where(
      and(
        eq(approvalQueue.id, id),
        isNull(approvalQueue.decision),
        or(isNull(approvalQueue.assignedTo), eq(approvalQueue.assignedTo, userId))
      )
    )
    .returning();
}

/**
 * Recent runs where the human reviewer disagreed with the auto verdict.
 * Ordered by recency. Used as few-shot examples for the next run.
 */
export async function getRecentDisagreements(agentId: string, limit = 5) {
  return db.execute<{
    run_id: string;
    auto_verdict: string;
    human_verdict: string;
    auto_reasoning: string | null;
    human_note: string | null;
    product_title: string | null;
    input_payload: Record<string, unknown> | null;
    created_at: string;
  }>(sql`
    with paired as (
      select
        ar.id as run_id,
        ar.input_payload,
        ar.created_at,
        p.title as product_title,
        max(case when ae.evaluation_type = 'auto'  then ae.verdict::text end) as auto_verdict,
        max(case when ae.evaluation_type = 'auto'  then ae.reasoning end) as auto_reasoning,
        max(case when ae.evaluation_type = 'human' then ae.verdict::text end) as human_verdict,
        max(case when ae.evaluation_type = 'human' then ae.reasoning end) as human_note
      from agent_runs ar
      left join agent_evaluations ae on ae.agent_run_id = ar.id
      left join products p on p.id = ar.product_id
      where ar.agent_id = ${agentId}
      group by ar.id, ar.input_payload, ar.created_at, p.title
    )
    select run_id, auto_verdict, human_verdict, auto_reasoning, human_note,
           product_title, input_payload, created_at
    from paired
    where auto_verdict is not null
      and human_verdict is not null
      and auto_verdict <> human_verdict
    order by created_at desc
    limit ${limit}
  `);
}

export async function getAgentById(id: string) {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ?? null;
}

export async function getPromptHistory(agentId: string) {
  return db
    .select()
    .from(agentPrompts)
    .where(eq(agentPrompts.agentId, agentId))
    .orderBy(desc(agentPrompts.version));
}

/**
 * Per-prompt-version quality metrics over the prompt's lifetime.
 * Returns one row per (agentId, promptId) with the same fields as agent quality.
 */
export async function getPromptVersionStats(agentId: string) {
  return db.execute<{
    prompt_id: string | null;
    runs: number;
    reviewed: number;
    agreement: number | null;
    human_reject_rate: number | null;
  }>(sql`
    with paired as (
      select
        ar.prompt_id,
        ar.id as run_id,
        max(case when ae.evaluation_type = 'auto'  then ae.verdict::text end) as auto_verdict,
        max(case when ae.evaluation_type = 'human' then ae.verdict::text end) as human_verdict
      from agent_runs ar
      left join agent_evaluations ae on ae.agent_run_id = ar.id
      where ar.agent_id = ${agentId}
      group by ar.prompt_id, ar.id
    )
    select
      prompt_id,
      count(*)::int as runs,
      count(*) filter (where human_verdict is not null)::int as reviewed,
      avg((auto_verdict = human_verdict)::int)
        filter (where auto_verdict is not null and human_verdict is not null)
        as agreement,
      avg((human_verdict = 'reject')::int)
        filter (where human_verdict is not null)
        as human_reject_rate
    from paired
    group by prompt_id
  `);
}

/** All skills, ordered by category then name. */
export async function getAllSkills(): Promise<Skill[]> {
  return db
    .select()
    .from(skills)
    .orderBy(asc(skills.category), asc(skills.name));
}

export async function getSkillById(id: string): Promise<Skill | null> {
  const [row] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
  return row ?? null;
}

export async function getSkillBySlug(slug: string): Promise<Skill | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(eq(skills.slug, slug))
    .limit(1);
  return row ?? null;
}

/**
 * For each skill, count how many agents have it attached. Used in /skills list.
 */
export async function getSkillsWithAttachCount() {
  const all = await getAllSkills();
  const counts = await db
    .select({
      skillId: agentSkills.skillId,
      attachCount: count(),
    })
    .from(agentSkills)
    .groupBy(agentSkills.skillId);
  const byId = new Map(counts.map((c) => [c.skillId, Number(c.attachCount)]));
  return all.map((s) => ({ ...s, attachCount: byId.get(s.id) ?? 0 }));
}

/** Skills attached to one agent, ordered by position. */
export async function getAgentAttachedSkills(agentId: string) {
  return db
    .select({
      skill: skills,
      position: agentSkills.position,
      parameters: agentSkills.parameters,
    })
    .from(agentSkills)
    .innerJoin(skills, eq(skills.id, agentSkills.skillId))
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(asc(agentSkills.position), asc(skills.name));
}

/** Agents currently using this skill. Used in /skills/[id]/edit. */
export async function getAgentsUsingSkill(skillId: string) {
  return db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      systemNo: agents.systemNo,
    })
    .from(agentSkills)
    .innerJoin(agents, eq(agents.id, agentSkills.agentId))
    .where(eq(agentSkills.skillId, skillId))
    .orderBy(asc(agents.systemNo), asc(agents.name));
}
