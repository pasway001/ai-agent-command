import type { z } from "zod";
import {
  startRun,
  finishRun,
  failRun,
  getActivePrompt,
  getAttachedSkills,
  composeSystemPrompt,
} from "../agent-sdk";
import { checkBudget } from "../budget";

export { BudgetExceededError } from "../budget";
import { runStructured } from "../llm";

export type AgentRunOutcome<T> = {
  runId: string;
  data: T;
  promptVersion: number | null;
  provider: string;
  model: string;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
};

export type AgentRunOpts<T> = {
  agentId: string;
  productId?: string | null;
  parentRunId?: string | null;
  defaultSystemPrompt: string;
  user: string;
  schema: z.ZodType<T>;
  mock: () => T;
  inputPayload?: Record<string, unknown>;
  webSearch?: boolean;
  webSearchMaxUses?: number;
  /** Override model for this agent call (e.g. HAIKU_MODEL for cheap pre-filters). */
  model?: string;
  /** Override provider for this agent call (e.g. "perplexity" for research agents). */
  provider?: import("../llm").LLMProvider;
};

/**
 * Standard agent execution: pick the active prompt (or fall back to default),
 * append any attached skill fragments, record startRun, call the LLM (real or
 * mock), and either finishRun or failRun. The composed system prompt and the
 * list of skill slugs used are persisted in agent_runs.input_payload so runs
 * remain reproducible after prompt/skill changes.
 */
export async function runAgent<T>(opts: AgentRunOpts<T>): Promise<AgentRunOutcome<T>> {
  // System 8: gate execution by daily/monthly budget. Throws BudgetExceededError
  // on hard limit (no startRun, no agent_runs row written). Soft crossings are
  // recorded asynchronously inside checkBudget() and don't block.
  await checkBudget(opts.agentId);

  const [activePrompt, attachedSkills] = await Promise.all([
    getActivePrompt(opts.agentId),
    getAttachedSkills(opts.agentId),
  ]);
  const basePrompt = activePrompt?.systemPrompt ?? opts.defaultSystemPrompt;
  const systemPrompt = composeSystemPrompt(basePrompt, attachedSkills);

  const run = await startRun({
    agentId: opts.agentId,
    productId: opts.productId ?? null,
    parentRunId: opts.parentRunId ?? null,
    promptId: activePrompt?.id ?? null,
    inputPayload: {
      ...(opts.inputPayload ?? {}),
      promptVersion: activePrompt?.version ?? null,
      skillSlugs: attachedSkills.map((s) => s.slug),
      composedSystemPrompt: systemPrompt,
    },
  });

  try {
    const { data, usage, provider, model } = await runStructured({
      system: systemPrompt,
      user: opts.user,
      schema: opts.schema,
      mock: opts.mock,
      webSearch: opts.webSearch,
      webSearchMaxUses: opts.webSearchMaxUses,
      model: opts.model,
      provider: opts.provider,
    });

    await finishRun({
      runId: run.id,
      agentId: opts.agentId,
      outputPayload: {
        ...(data as Record<string, unknown>),
        provider,
        model,
      },
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
    });

    return {
      runId: run.id,
      data,
      promptVersion: activePrompt?.version ?? null,
      provider,
      model,
      usage,
    };
  } catch (err) {
    await failRun({
      runId: run.id,
      agentId: opts.agentId,
      errorMessage: (err as Error).message,
    });
    throw err;
  }
}
