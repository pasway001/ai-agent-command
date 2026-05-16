import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { approvalDecisionEnum } from "./enums";
import { agentRuns } from "./runs";
import { products } from "./products";

export const approvalQueue = pgTable(
  "approval_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    requiredRole: text("required_role"), // e.g. "reviewer"
    priority: integer("priority").notNull().default(0), // higher = more urgent
    assignedTo: uuid("assigned_to"), // auth.users.id
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    decision: approvalDecisionEnum("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by"),
    decisionNote: text("decision_note"),
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("approval_queue_open_idx").on(table.decision, table.priority),
    index("approval_queue_assigned_idx").on(table.assignedTo),
  ]
);

export type ApprovalItem = typeof approvalQueue.$inferSelect;
export type NewApprovalItem = typeof approvalQueue.$inferInsert;
