import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  agentRunStatusEnum,
  evaluationTypeEnum,
  verdictEnum,
} from "./enums";
import { agents, agentPrompts } from "./agents";
import { products } from "./products";

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    parentRunId: uuid("parent_run_id").references(
      (): AnyPgColumn => agentRuns.id,
      { onDelete: "set null" }
    ),
    promptId: uuid("prompt_id").references(() => agentPrompts.id, {
      onDelete: "set null",
    }),
    status: agentRunStatusEnum("status").notNull().default("queued"),
    inputPayload: jsonb("input_payload")
      .$type<Record<string, unknown>>()
      .default({}),
    outputPayload: jsonb("output_payload")
      .$type<Record<string, unknown>>()
      .default({}),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_runs_agent_idx").on(table.agentId),
    index("agent_runs_product_idx").on(table.productId),
    index("agent_runs_status_idx").on(table.status),
    index("agent_runs_started_idx").on(table.startedAt),
  ]
);

export const agentEvaluations = pgTable(
  "agent_evaluations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    evaluationType: evaluationTypeEnum("evaluation_type").notNull(),
    verdict: verdictEnum("verdict").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }),
    evaluatorId: uuid("evaluator_id"), // auth.users.id when human; null when auto
    reasoning: text("reasoning"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("agent_evaluations_run_idx").on(table.agentRunId),
    index("agent_evaluations_product_idx").on(table.productId),
  ]
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentEvaluation = typeof agentEvaluations.$inferSelect;
