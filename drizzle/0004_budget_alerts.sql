-- Manual migration: budget_alerts (System 8 — Cost & Budget Monitor).
-- Idempotent — safe to re-run.
--
-- Records when an agent crosses a budget threshold (soft 80% / hard 100% / breach override).
-- The unique constraint (agent_id, alert_date, period, threshold) guarantees at most one
-- Lark notification per agent per day per period per threshold — implementing the
-- "idempotent alert" requirement from system08_cost_budget_monitor.md §4.2.

CREATE TABLE IF NOT EXISTS budget_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  alert_date date NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'monthly')),
  threshold text NOT NULL CHECK (threshold IN ('soft', 'hard', 'breach')),
  consumed_usd numeric(10, 4) NOT NULL,
  budget_usd numeric(10, 4) NOT NULL,
  consumed_pct numeric(7, 2) NOT NULL,
  lark_sent_at timestamptz,
  lark_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, alert_date, period, threshold)
);

CREATE INDEX IF NOT EXISTS budget_alerts_date_idx ON budget_alerts (alert_date DESC);
CREATE INDEX IF NOT EXISTS budget_alerts_agent_idx ON budget_alerts (agent_id);

-- RLS
ALTER TABLE budget_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read budget_alerts" ON budget_alerts;
CREATE POLICY "auth read budget_alerts" ON budget_alerts
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write budget_alerts" ON budget_alerts;
CREATE POLICY "auth write budget_alerts" ON budget_alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
