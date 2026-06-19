import { and, asc, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "./index";
import {
  agents,
  agentPrompts,
  agentRuns,
  agentSkills,
  approvalQueue,
  budgetAlerts,
  products,
  scoutRuns,
  skills,
  type Agent,
  type Product,
  type ScoutRun,
  type Skill,
} from "./schema";
import { SCOUT_AXIS_KEYS } from "../scout-review";
import type {
  ScoutAxisScores,
  ScoutEvidenceItem,
  ScoutProductType,
  ScoutReviewDetails,
  ScoutVerdict,
} from "../scout-review";

export { SCOUT_AXIS_KEYS } from "../scout-review";
export type {
  ScoutAxisKey,
  ScoutAxisScore,
  ScoutAxisScores,
  ScoutEvidenceItem,
  ScoutReviewDetails,
} from "../scout-review";

export async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("[db query failed]", err);
    return null;
  }
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function stringValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function stringArrayValue(record: JsonRecord | null, key: string) {
  const value = record?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0
  );
}

function verdictValue(record: JsonRecord | null, key: string): ScoutVerdict | null {
  const value = record?.[key];
  if (value === "approve" || value === "reject" || value === "escalate") {
    return value;
  }
  return null;
}

function productTypeValue(
  record: JsonRecord | null,
  key: string
): ScoutProductType | null {
  const value = record?.[key];
  if (
    value === "physical" ||
    value === "digital" ||
    value === "service" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function extractAxisScores(outputPayload: JsonRecord | null): ScoutAxisScores | null {
  const raw = asRecord(outputPayload?.axisScores);
  if (!raw) return null;
  const result: ScoutAxisScores = {};
  for (const key of SCOUT_AXIS_KEYS) {
    const ax = asRecord(raw[key]);
    if (!ax) continue;
    const score = numberValue(ax, "score");
    const rationale = stringValue(ax, "rationale") ?? "";
    if (score === null) continue;
    result[key] = { score, rationale };
  }
  return Object.keys(result).length > 0 ? result : null;
}

function extractEvidence(outputPayload: JsonRecord | null): ScoutEvidenceItem[] {
  const raw = outputPayload?.evidence;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ScoutEvidenceItem | null => {
      const rec = asRecord(item);
      if (!rec) return null;
      const claim = stringValue(rec, "claim");
      const sourceUrl = stringValue(rec, "sourceUrl");
      const snippet = stringValue(rec, "snippet");
      if (!claim || !sourceUrl || !snippet) return null;
      return { claim, sourceUrl, snippet };
    })
    .filter((e): e is ScoutEvidenceItem => e !== null);
}

function extractMentionSources(signals: JsonRecord | null): string[] {
  const raw = signals?.mentionSources;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s.length > 0);
}

function scoutReviewDetails(
  productMetadata: unknown,
  runInputPayload: unknown,
  runOutputPayload: unknown
): ScoutReviewDetails {
  const metadata = asRecord(productMetadata);
  const inputPayload = asRecord(runInputPayload);
  const outputPayload = asRecord(runOutputPayload);
  const signals =
    asRecord(metadata?.signals) ?? asRecord(inputPayload?.signals);
  const shortlist = asRecord(metadata?.shortlist);
  const salesReadiness = asRecord(metadata?.salesReadiness);
  const overseas = asRecord(signals?.overseas);
  const japan = asRecord(signals?.japan);
  const japanAngle =
    stringValue(shortlist, "japanAngle") ?? stringValue(japan, "searchSummary");

  return {
    sourceName: stringValue(overseas, "source"),
    sourceUrl: stringValue(overseas, "url"),
    description: stringValue(overseas, "description"),
    publishedAt: stringValue(overseas, "publishedAt"),
    category: stringValue(signals, "category"),
    score: numberValue(outputPayload, "score") ?? numberValue(outputPayload, "totalScore"),
    verdict: verdictValue(outputPayload, "verdict"),
    rationale: stringValue(outputPayload, "rationale"),
    pros: stringArrayValue(outputPayload, "pros"),
    cons: stringArrayValue(outputPayload, "cons"),
    suggestedPriority: numberValue(outputPayload, "suggestedPriority"),
    provider: stringValue(outputPayload, "provider"),
    model: stringValue(outputPayload, "model"),
    productType: productTypeValue(signals, "productType"),
    physicalProductLikely: booleanValue(signals, "physicalProductLikely"),
    exclusionReason: stringValue(signals, "exclusionReason"),
    japanSummary: japanAngle,
    domesticExamples: stringArrayValue(japan, "domesticExamples"),
    similarProductCount: numberValue(japan, "similarProductCount"),
    notYetInJapan: booleanValue(japan, "notYetInJapan"),
    // ---- Phase B additions ----
    axisScores: extractAxisScores(outputPayload),
    evidence: extractEvidence(outputPayload),
    mentionSources: extractMentionSources(signals),
    japanValidationLevel: numberValue(japan, "japanValidationLevel"),
    shortlistRank: numberValue(shortlist, "rank"),
    shortlistScore: numberValue(shortlist, "score"),
    japanAngle,
    nextAction:
      stringValue(salesReadiness, "nextAction") ??
      stringValue(shortlist, "nextAction"),
    salesPriority: numberValue(salesReadiness, "priority"),
    salesReasons:
      stringArrayValue(salesReadiness, "reasons").length > 0
        ? stringArrayValue(salesReadiness, "reasons")
        : stringArrayValue(shortlist, "reasons"),
    salesRisks:
      stringArrayValue(salesReadiness, "risks").length > 0
        ? stringArrayValue(salesReadiness, "risks")
        : stringArrayValue(shortlist, "risks"),
    importedAt: stringValue(salesReadiness, "importedAt"),
    sourceReportGeneratedAt: stringValue(
      salesReadiness,
      "sourceReportGeneratedAt"
    ),
  };
}

export async function getOpenApprovals() {
  const rows = await db
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
      productMetadata: products.metadata,
      runInputPayload: agentRuns.inputPayload,
      runOutputPayload: agentRuns.outputPayload,
    })
    .from(approvalQueue)
    .leftJoin(agentRuns, eq(approvalQueue.agentRunId, agentRuns.id))
    .leftJoin(products, eq(approvalQueue.productId, products.id))
    .where(isNull(approvalQueue.decision))
    .orderBy(desc(approvalQueue.priority), approvalQueue.createdAt);

  return rows.map(
    ({ productMetadata, runInputPayload, runOutputPayload, ...row }) => ({
      ...row,
      review: scoutReviewDetails(
        productMetadata,
        runInputPayload,
        runOutputPayload
      ),
    })
  );
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
      dailyBudgetUsd: number | null;
      monthlyBudgetUsd: number | null;
    }
  >();

  // Seed with every known agent so budget bars render even before first run.
  for (const a of allAgents) {
    grouped.set(a.id, {
      agentId: a.id,
      agentName: a.name,
      systemNo: a.systemNo,
      todayUsd: 0,
      monthUsd: 0,
      tokensInMonth: 0,
      tokensOutMonth: 0,
      totalRuns: 0,
      dailyBudgetUsd: a.dailyBudgetUsd != null ? Number(a.dailyBudgetUsd) : null,
      monthlyBudgetUsd:
        a.monthlyBudgetUsd != null ? Number(a.monthlyBudgetUsd) : null,
    });
  }

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
        dailyBudgetUsd:
          meta?.dailyBudgetUsd != null ? Number(meta.dailyBudgetUsd) : null,
        monthlyBudgetUsd:
          meta?.monthlyBudgetUsd != null ? Number(meta.monthlyBudgetUsd) : null,
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
    .filter((r) => r.totalRuns > 0 || r.dailyBudgetUsd != null || r.monthlyBudgetUsd != null)
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
      dailyBudgetUsd: row.dailyBudgetUsd,
      monthlyBudgetUsd: row.monthlyBudgetUsd,
      dailyPct:
        row.dailyBudgetUsd && row.dailyBudgetUsd > 0
          ? (row.todayUsd / row.dailyBudgetUsd) * 100
          : null,
      monthlyPct:
        row.monthlyBudgetUsd && row.monthlyBudgetUsd > 0
          ? (row.monthUsd / row.monthlyBudgetUsd) * 100
          : null,
    }));
}

export async function getTodayBudgetAlertCount(): Promise<{
  soft: number;
  hard: number;
  breach: number;
}> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(today.getDate()).padStart(2, "0")}`;
  const rows = await db
    .select({
      threshold: budgetAlerts.threshold,
      count: sql<number>`count(*)::int`,
    })
    .from(budgetAlerts)
    .where(eq(budgetAlerts.alertDate, todayStr))
    .groupBy(budgetAlerts.threshold);
  const get = (t: string) => rows.find((r) => r.threshold === t)?.count ?? 0;
  return { soft: get("soft"), hard: get("hard"), breach: get("breach") };
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

// ---------------------------------------------------------------------------
// scout_runs — Phase A visibility layer.
// One row per runMinimalScout() invocation.
// ---------------------------------------------------------------------------

/** Latest N scout runs, newest first. */
export async function getRecentScoutRuns(limit = 30): Promise<ScoutRun[]> {
  return db
    .select()
    .from(scoutRuns)
    .orderBy(desc(scoutRuns.startedAt))
    .limit(limit);
}

/** Single scout run by id (for /scout-runs/[id]). */
export async function getScoutRunById(id: string): Promise<ScoutRun | null> {
  const [row] = await db
    .select()
    .from(scoutRuns)
    .where(eq(scoutRuns.id, id))
    .limit(1);
  return row ?? null;
}

/** Most recent completed scout run (used in the /inbox summary banner). */
export async function getLatestScoutRun(): Promise<ScoutRun | null> {
  const [row] = await db
    .select()
    .from(scoutRuns)
    .orderBy(desc(scoutRuns.startedAt))
    .limit(1);
  return row ?? null;
}
