import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { agents } from "../db/schema";
import { mergeProductMetadata } from "../agent-sdk";
import { runAgent } from "./_runner";

/**
 * Generic runner for "dynamic" agents created from the UI (/agents/new).
 *
 * The agent has no hand-written TS file. Instead it stores a system prompt
 * (in agent_prompts) and a user_prompt_template + optional output_schema /
 * signal_key on the agents row. We compose the user prompt, run it through
 * the standard runAgent() pipeline, and (for scout agents with a signal_key)
 * merge the output into products.metadata.signals.<signalKey>.
 *
 * Until a real LLM key is wired up, the mock provider returns a deterministic
 * echo derived from the input — enough to drive the UI end-to-end.
 */

export type RunDbAgentInput = {
  agentId: string;
  productId?: string | null;
  parentRunId?: string | null;
  /** Free-form input passed to the template and recorded as inputPayload. */
  input: Record<string, unknown>;
};

export type RunDbAgentResult = {
  runId: string;
  output: Record<string, unknown>;
  promptVersion: number | null;
};

// Replace {{key}} / {{ key }} with input[key]. Unknown keys leave the
// placeholder intact so it's visible to the reviewer.
function fillTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, rawKey: string) => {
    const path = rawKey.split(".");
    let cur: unknown = input;
    for (const k of path) {
      if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[k];
      } else {
        return `{{${rawKey}}}`;
      }
    }
    if (cur === null || cur === undefined) return `{{${rawKey}}}`;
    return typeof cur === "string" ? cur : JSON.stringify(cur);
  });
}

function defaultUserPrompt(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
}

// FNV-1a — same family as the existing scout mocks, kept local to avoid coupling.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic mock output. If the agent declared an output_schema with
 * top-level fields, we synthesize a value per field type. Otherwise we
 * return a generic { summary, score } shape that's useful for the UI.
 */
function mockFromSchema(
  outputSchema: Record<string, unknown> | null,
  seed: number
): Record<string, unknown> {
  if (!outputSchema || typeof outputSchema !== "object") {
    return {
      summary: `mock output (seed=${seed.toString(16).slice(0, 6)})`,
      score: Number(((seed % 1000) / 1000).toFixed(3)),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(outputSchema)) {
    const type =
      typeof spec === "string"
        ? spec
        : (spec as { type?: string })?.type ?? "string";
    const localSeed = hashStr(key + ":" + seed);
    switch (type) {
      case "number":
        out[key] = Number((localSeed % 1000) / 10);
        break;
      case "integer":
        out[key] = localSeed % 100;
        break;
      case "boolean":
        out[key] = (localSeed & 1) === 1;
        break;
      case "array":
        out[key] = [`mock-${localSeed % 100}`];
        break;
      case "object":
        out[key] = { value: `mock-${localSeed % 100}` };
        break;
      case "string":
      default:
        out[key] = `mock ${key} (${localSeed.toString(16).slice(0, 4)})`;
    }
  }
  return out;
}

const PermissiveOutputSchema = z.record(z.string(), z.unknown());

export async function runDbAgent(
  opts: RunDbAgentInput
): Promise<RunDbAgentResult> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, opts.agentId))
    .limit(1);
  if (!agent) throw new Error(`agent ${opts.agentId} not found`);
  if (!agent.isDynamic) {
    throw new Error(
      `agent ${opts.agentId} is not a dynamic agent — call its dedicated runner instead`
    );
  }

  const userPrompt = agent.userPromptTemplate
    ? fillTemplate(agent.userPromptTemplate, opts.input)
    : defaultUserPrompt(opts.input);

  const seed = hashStr(`${agent.id}:${JSON.stringify(opts.input)}`);

  const outcome = await runAgent({
    agentId: agent.id,
    productId: opts.productId ?? null,
    parentRunId: opts.parentRunId ?? null,
    // Active prompt is loaded inside runAgent; this fallback is used only when
    // no prompt version exists for the agent yet.
    defaultSystemPrompt:
      agent.description ??
      `You are ${agent.name}. Respond with a JSON object describing your analysis.`,
    user: userPrompt,
    schema: PermissiveOutputSchema,
    mock: () => mockFromSchema(agent.outputSchema ?? null, seed),
    inputPayload: opts.input,
  });

  if (agent.signalKey && opts.productId) {
    await mergeProductMetadata(opts.productId, {
      signals: { [agent.signalKey]: outcome.data },
    });
  }

  return {
    runId: outcome.runId,
    output: outcome.data,
    promptVersion: outcome.promptVersion,
  };
}
