-- Phase 4C: Agentic workflow persistence
-- workflow_runs: top-level workflow state (plan → approved → running → completed/failed/cancelled)
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  -- valid statuses: pending | approved | running | completed | failed | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- workflow_steps: one row per planned tool call
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'read',
  -- valid risk levels: read | write | irreversible
  status TEXT NOT NULL DEFAULT 'pending',
  -- valid statuses: pending | running | completed | failed | skipped
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_run_id, step_index)
);

-- Enable Row Level Security
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;

-- Users can only access their own workflow_runs
CREATE POLICY "users_own_workflow_runs"
  ON workflow_runs
  FOR ALL
  USING (auth.uid() = user_id);

-- Users can access steps only if they own the parent run
CREATE POLICY "users_own_workflow_steps"
  ON workflow_steps
  FOR ALL
  USING (
    workflow_run_id IN (
      SELECT id FROM workflow_runs WHERE user_id = auth.uid()
    )
  );

-- Indexes for fast query patterns
CREATE INDEX idx_workflow_runs_user_status
  ON workflow_runs (user_id, status, created_at DESC);
CREATE INDEX idx_workflow_runs_conversation
  ON workflow_runs (conversation_id);
CREATE INDEX idx_workflow_steps_run
  ON workflow_steps (workflow_run_id, step_index);
