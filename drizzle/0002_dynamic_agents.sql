-- Manual migration: add UI-creatable "dynamic" agent metadata to the agents table.
-- Idempotent — safe to re-run.
--
-- A dynamic agent is one created from /agents/new instead of having a hand-written
-- TS file under src/lib/agents/. It is executed by the generic runDbAgent() helper
-- which composes the user prompt from user_prompt_template + input, validates the
-- output against output_schema (or accepts any object if null), and (for scout
-- agents with signal_key set) merges the result into products.metadata.signals.<signal_key>.

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS is_dynamic boolean NOT NULL DEFAULT false;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS user_prompt_template text;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS output_schema jsonb;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS signal_key text;
