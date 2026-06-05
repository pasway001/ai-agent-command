-- Manual migration: scout_runs (Phase A — Visibility Layer).
-- Idempotent — safe to re-run.
--
-- Records one row per runMinimalScout() invocation so reviewers can see
-- "what was fetched, what was filtered, what reached Inbox" without
-- opening the code.
--
-- Apply locally:
--   pnpm db:apply-migration drizzle/0005_scout_runs.sql
-- Or against Supabase (NOT in Phase A — Phase B):
--   pnpm db:migrate

CREATE TABLE IF NOT EXISTS scout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  triggered_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  feed_count integer NOT NULL DEFAULT 0,
  raw_item_count integer NOT NULL DEFAULT 0,
  physical_count integer NOT NULL DEFAULT 0,
  dedup_dropped_count integer NOT NULL DEFAULT 0,
  scored_count integer NOT NULL DEFAULT 0,
  enqueued_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  per_feed jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text
);

CREATE INDEX IF NOT EXISTS scout_runs_started_idx ON scout_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS scout_runs_triggered_idx ON scout_runs (triggered_by);

-- RLS — authenticated users can read; service role writes.
ALTER TABLE scout_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read scout_runs" ON scout_runs;
CREATE POLICY "auth read scout_runs" ON scout_runs
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write scout_runs" ON scout_runs;
CREATE POLICY "auth write scout_runs" ON scout_runs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
