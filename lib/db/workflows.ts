import { createServerClient } from "@/lib/supabase/server";

export type WorkflowStatus =
  | "pending"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type RiskLevel = "read" | "write" | "irreversible";

export interface WorkflowStepRow {
  id: string;
  workflow_run_id: string;
  step_index: number;
  tool_name: string;
  args: Record<string, unknown>;
  description: string;
  risk_level: RiskLevel;
  status: StepStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export async function createWorkflowRun(params: {
  userId: string;
  conversationId: string;
  title: string;
  description: string;
  steps: Array<{
    stepIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    description: string;
    riskLevel: RiskLevel;
  }>;
}): Promise<WorkflowRunRow> {
  const supabase = createServerClient();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      title: params.title,
      description: params.description,
      status: "pending",
    })
    .select()
    .single<WorkflowRunRow>();

  if (runError || !run) throw runError ?? new Error("Failed to create workflow run");

  const stepRows = params.steps.map((s) => ({
    workflow_run_id: run.id,
    step_index: s.stepIndex,
    tool_name: s.toolName,
    args: s.args,
    description: s.description,
    risk_level: s.riskLevel,
    status: "pending",
  }));

  const { error: stepsError } = await supabase
    .from("workflow_steps")
    .insert(stepRows);

  if (stepsError) {
    // Clean up orphaned run if steps insert fails
    try {
      await supabase.from("workflow_runs").delete().eq("id", run.id);
    } catch {
      // Ignore cleanup errors
    }
    throw stepsError;
  }

  return run;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunRow | null> {
  const supabase = createServerClient();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", id)
    .single<WorkflowRunRow>();

  if (runError) return null;
  if (!run) return null;

  return run;
}

export async function getWorkflowWithSteps(
  id: string,
): Promise<(WorkflowRunRow & { steps: WorkflowStepRow[] }) | null> {
  const supabase = createServerClient();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", id)
    .single<WorkflowRunRow>();

  if (runError) return null;
  if (!run) return null;

  const { data: steps, error: stepsError } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_run_id", id)
    .order("step_index", { ascending: true });

  // If the run exists but we can't query its steps, that's a database problem.
  // We throw here to surface the issue to callers rather than silently returning
  // inconsistent data (a run with missing steps).
  if (stepsError) throw stepsError;

  return { ...run, steps: (steps ?? []) as WorkflowStepRow[] };
}

export async function updateWorkflowStatus(
  id: string,
  status: WorkflowStatus,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("workflow_runs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  result?: Record<string, unknown> | null,
  errorMsg?: string | null,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({
      status,
      result: result ?? null,
      error: errorMsg ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId);
  if (error) throw error;
}
