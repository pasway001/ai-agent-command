-- Manual migration: add agent_prompts table and agent_runs.prompt_id column.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS agent_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  system_prompt text NOT NULL,
  user_template text,
  model text,
  parameters jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_prompts_agent_version_uq
  ON agent_prompts (agent_id, version);

CREATE INDEX IF NOT EXISTS agent_prompts_active_idx
  ON agent_prompts (agent_id, is_active);

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS prompt_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_runs_prompt_id_agent_prompts_id_fk'
  ) THEN
    ALTER TABLE agent_runs
      ADD CONSTRAINT agent_runs_prompt_id_agent_prompts_id_fk
      FOREIGN KEY (prompt_id) REFERENCES agent_prompts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- RLS for agent_prompts
ALTER TABLE agent_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read agent_prompts" ON agent_prompts;
CREATE POLICY "auth read agent_prompts" ON agent_prompts
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write agent_prompts" ON agent_prompts;
CREATE POLICY "auth write agent_prompts" ON agent_prompts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
