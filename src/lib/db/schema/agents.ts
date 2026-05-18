import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  date,
  uuid,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentRunStatusEnum } from "./enums";

export const agents = pgTable("agents", {
  id: text("id").primaryKey(), // e.g. "scout.keepa_monitor"
  name: text("name").notNull(),
  systemNo: integer("system_no").notNull(), // 1..6
  agentType: text("agent_type").notNull(), // scout|lp|ad|outreach|cs
  description: text("description"),
  scheduleCron: text("schedule_cron"),
  enabled: boolean("enabled").notNull().default(true),
  concurrencyLimit: integer("concurrency_limit").notNull().default(1),
  dailyBudgetUsd: numeric("daily_budget_usd", { precision: 10, scale: 4 }),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 10, scale: 4 }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: agentRunStatusEnum("last_status"),
  // Dynamic agents are created from the UI (/agents/new) instead of having a
  // hand-written TS file under src/lib/agents/. Executed by runDbAgent().
  isDynamic: boolean("is_dynamic").notNull().default(false),
  userPromptTemplate: text("user_prompt_template"),
  outputSchema: jsonb("output_schema").$type<Record<string, unknown>>(),
  // Optional. When set on a scout agent, runDbAgent merges its output into
  // products.metadata.signals.<signalKey> so downstream scoring can pick it up.
  signalKey: text("signal_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const costLedger = pgTable(
  "cost_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    date: date("date").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0"),
    runCount: integer("run_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("cost_ledger_date_idx").on(table.date),
    index("cost_ledger_agent_idx").on(table.agentId),
  ]
);

export const agentPrompts = pgTable(
  "agent_prompts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    userTemplate: text("user_template"),
    model: text("model"),
    parameters: jsonb("parameters")
      .$type<Record<string, unknown>>()
      .default({}),
    isActive: boolean("is_active").notNull().default(false),
    notes: text("notes"),
    createdBy: uuid("created_by"), // auth.users.id
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_prompts_agent_version_uq").on(
      table.agentId,
      table.version
    ),
    index("agent_prompts_active_idx").on(table.agentId, table.isActive),
  ]
);

export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    alertDate: date("alert_date").notNull(),
    period: text("period").notNull(), // 'daily' | 'monthly'
    threshold: text("threshold").notNull(), // 'soft' | 'hard' | 'breach'
    consumedUsd: numeric("consumed_usd", { precision: 10, scale: 4 }).notNull(),
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 4 }).notNull(),
    consumedPct: numeric("consumed_pct", { precision: 7, scale: 2 }).notNull(),
    larkSentAt: timestamp("lark_sent_at", { withTimezone: true }),
    larkResponse: jsonb("lark_response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("budget_alerts_date_idx").on(table.alertDate),
    index("budget_alerts_agent_idx").on(table.agentId),
    uniqueIndex("budget_alerts_unique").on(
      table.agentId,
      table.alertDate,
      table.period,
      table.threshold
    ),
  ]
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type AgentPrompt = typeof agentPrompts.$inferSelect;
export type NewAgentPrompt = typeof agentPrompts.$inferInsert;
export type BudgetAlert = typeof budgetAlerts.$inferSelect;
export type NewBudgetAlert = typeof budgetAlerts.$inferInsert;
