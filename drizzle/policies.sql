-- RLS policies (A案: authenticated reviewers can read & write everything).
-- Run AFTER `pnpm db:push` so all tables exist.
-- The service_role key bypasses RLS automatically — agent workers use it.

ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_skills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_evaluations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_queue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_ledger         ENABLE ROW LEVEL SECURITY;

-- Helper: drop existing policy if any, then create fresh.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products', 'agents', 'agent_prompts', 'skills', 'agent_skills',
    'agent_runs', 'agent_evaluations', 'approval_queue', 'cost_ledger'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "auth read %I" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "auth read %I" ON %I FOR SELECT TO authenticated USING (true)',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS "auth write %I" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "auth write %I" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;

-- Enable Supabase Realtime on tables that the UI subscribes to.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_queue', 'agent_runs', 'products'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;
