import { pgEnum } from "drizzle-orm/pg-core";

export const productStageEnum = pgEnum("product_stage", [
  "scout",
  "lp",
  "ad",
  "outreach",
  "cs",
  "archived",
]);

export const productStatusEnum = pgEnum("product_status", [
  "pending",
  "approved",
  "rejected",
  "on_hold",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const evaluationTypeEnum = pgEnum("evaluation_type", ["auto", "human"]);

export const verdictEnum = pgEnum("verdict", ["approve", "reject", "escalate"]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "approve",
  "reject",
]);
