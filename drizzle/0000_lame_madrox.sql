CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."evaluation_type" AS ENUM('auto', 'human');--> statement-breakpoint
CREATE TYPE "public"."product_stage" AS ENUM('scout', 'lp', 'ad', 'outreach', 'cs', 'archived');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('pending', 'approved', 'rejected', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('approve', 'reject', 'escalate');--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asin" text,
	"jan" text,
	"title" text NOT NULL,
	"source_agent_id" text,
	"stage" "product_stage" DEFAULT 'scout' NOT NULL,
	"status" "product_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"system_no" integer NOT NULL,
	"agent_type" text NOT NULL,
	"description" text,
	"schedule_cron" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"concurrency_limit" integer DEFAULT 1 NOT NULL,
	"daily_budget_usd" numeric(10, 4),
	"monthly_budget_usd" numeric(10, 4),
	"last_run_at" timestamp with time zone,
	"last_status" "agent_run_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"agent_id" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"product_id" uuid,
	"evaluation_type" "evaluation_type" NOT NULL,
	"verdict" "verdict" NOT NULL,
	"score" numeric(5, 2),
	"evaluator_id" uuid,
	"reasoning" text,
	"evidence" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"product_id" uuid,
	"parent_run_id" uuid,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"input_payload" jsonb DEFAULT '{}'::jsonb,
	"output_payload" jsonb DEFAULT '{}'::jsonb,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"product_id" uuid,
	"required_role" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"claimed_at" timestamp with time zone,
	"decision" "approval_decision",
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_note" text,
	"sla_deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluations" ADD CONSTRAINT "agent_evaluations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_evaluations" ADD CONSTRAINT "agent_evaluations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_parent_run_id_agent_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_queue" ADD CONSTRAINT "approval_queue_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_queue" ADD CONSTRAINT "approval_queue_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_stage_idx" ON "products" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_asin_idx" ON "products" USING btree ("asin");--> statement-breakpoint
CREATE INDEX "cost_ledger_date_idx" ON "cost_ledger" USING btree ("date");--> statement-breakpoint
CREATE INDEX "cost_ledger_agent_idx" ON "cost_ledger" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_evaluations_run_idx" ON "agent_evaluations" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_evaluations_product_idx" ON "agent_evaluations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_runs_product_idx" ON "agent_runs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "approval_queue_open_idx" ON "approval_queue" USING btree ("decision","priority");--> statement-breakpoint
CREATE INDEX "approval_queue_assigned_idx" ON "approval_queue" USING btree ("assigned_to");