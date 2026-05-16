-- Manual migration: skills (reusable system-prompt fragments) and agent_skills (M:N).
-- Idempotent — safe to re-run.
--
-- Skills are functional modules that can be attached to multiple agents.
-- Each skill carries:
--   - prompt_fragment: a chunk of system prompt (role/procedure/output format)
--   - parameters_schema (jsonb): optional shape for skill-specific parameters
-- At run time, runAgent() composes:
--   <base system prompt>\n\n<skill1.prompt_fragment>\n\n<skill2.prompt_fragment>...
-- ordered by agent_skills.position ASC.

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  slug text NOT NULL UNIQUE,
  category text NOT NULL,
  name text NOT NULL,
  description text,
  prompt_fragment text NOT NULL,
  parameters_schema jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skills_category_idx ON skills (category);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  parameters jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS agent_skills_agent_idx ON agent_skills (agent_id, position);
CREATE INDEX IF NOT EXISTS agent_skills_skill_idx ON agent_skills (skill_id);

-- RLS
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read skills" ON skills;
CREATE POLICY "auth read skills" ON skills
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write skills" ON skills;
CREATE POLICY "auth write skills" ON skills
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE agent_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read agent_skills" ON agent_skills;
CREATE POLICY "auth read agent_skills" ON agent_skills
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write agent_skills" ON agent_skills;
CREATE POLICY "auth write agent_skills" ON agent_skills
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
