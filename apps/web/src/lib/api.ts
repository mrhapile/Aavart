export interface HealthResponse {
  status: "ok";
  service: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  field: string;
  row: number | null;
}

export interface ValidationResponse {
  valid: boolean;
  snapshot_candidate_id: string | null;
  errors: ValidationIssue[];
  counts: { jobs: number; windows: number; assets: number; sections: number; resources: number };
}

export interface ScheduleItem {
  job_id: string;
  window_id: string;
  start: string;
  end: string;
  status: "SCHEDULED" | "LOCKED" | "REJECTED";
  reason_codes: string[];
  locked: boolean;
}

export interface JobContext {
  job_id: string;
  department: string;
  asset_id: string;
  section_id: string;
  work_type: string;
  priority: number;
  duration_minutes: number;
  required_resources: string[];
  allowed_windows: string[];
}

export interface ApprovalSummary {
  reviewer: string;
  comment: string;
  approved_at: string;
  run_id: string;
  snapshot_id: string;
  ruleset_version: string;
}

export interface ValidatorSummary {
  passed: boolean;
  issues: Array<Record<string, unknown>>;
  validated_at: string;
}

export interface KpiSummary {
  baseline_closure_minutes: number;
  optimized_closure_minutes: number;
  scheduled_maintenance_minutes: number;
  rejected_maintenance_minutes: number;
  baseline_asset_downtime_minutes: number;
  optimized_asset_downtime_minutes: number;
  downtime_reduction_minutes: number;
  downtime_reduction_percent: number;
}

export interface AiEstimate {
  job_id: string;
  source: "LOCAL_HEURISTIC" | "DETERMINISTIC_FALLBACK";
  priority: number;
  duration_minutes: number;
  duration_min_minutes: number;
  duration_max_minutes: number;
  reason_codes: string[];
}

export interface RunDetail {
  run_id: string;
  state: "QUEUED" | "RUNNING" | "FEASIBLE" | "OPTIMAL" | "INFEASIBLE" | "TIMEOUT" | "INVALID" | "FAILED";
  snapshot_id: string;
  snapshot_status: string;
  ruleset_version: string;
  created_at: string;
  completed_at: string | null;
  parent_run_id: string | null;
  schedule_items: ScheduleItem[];
  unscheduled_jobs: Array<{ job_id: string; reason_codes: string[] }>;
  jobs: JobContext[];
  validator: ValidatorSummary;
  approval: ApprovalSummary | null;
  changes: Record<string, "SCHEDULED" | "REJECTED" | "PRESERVED" | "CHANGED">;
  export_ready: boolean;
  kpis: KpiSummary;
  ai_estimates: AiEstimate[];
}

/** Archive row from GET /planning-runs - no schedule_items/jobs payload. */
export interface PlanningRunSummary {
  run_id: string;
  state: RunDetail["state"];
  snapshot_id: string;
  ruleset_version: string;
  created_at: string;
  completed_at: string | null;
  parent_run_id: string | null;
  trigger_type: string;
  total_job_count: number;
  scheduled_job_count: number;
  validator_passed: boolean;
  approval: ApprovalSummary | null;
  kpis: KpiSummary | null;
}

interface RunCreated {
  run_id: string;
}

export interface RapidBlockJob {
  job_id: string;
  department: "TRACK" | "SIGNAL" | "ELECTRICAL" | "CIVIL";
  asset_id: string;
  section_id: string;
  work_type: string;
  priority: number;
  duration_minutes: number;
  duration_min_minutes: number;
  duration_max_minutes: number;
  required_resources: string[];
  allowed_windows: string[];
  status: "UNSCHEDULED" | "SCHEDULED" | "LOCKED" | "REJECTED" | "INVALID";
}

export interface RapidBlockRequestPayload {
  base_run_id: string;
  actor: string;
  actor_role: "PLANNER";
  justification: string;
  source_reported_at: string;
  urgent_job: RapidBlockJob;
}

export interface RapidBlockResponse {
  request_id: string;
  state: "SUBMITTED" | "VALIDATING" | "REJECTED" | "PLANNING" | "CANDIDATE_READY" | "NO_CANDIDATE";
  base_run_id: string;
  base_snapshot_id: string;
  derived_snapshot_id: string | null;
  child_run_id: string | null;
  reason_codes: string[];
  status_url: string;
}

export interface RapidBlockDetail extends RapidBlockResponse {
  actor: string;
  actor_role: "PLANNER";
  justification: string;
  source_reported_at: string;
  urgent_job: RapidBlockJob;
  changed_jobs: Record<string, "SCHEDULED" | "REJECTED" | "PRESERVED" | "CHANGED">;
  preserved_locked_jobs: string[];
  validator: ValidatorSummary | null;
  candidate_plan_status: RunDetail["state"] | null;
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function getApiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${apiUrl}/health`, { signal });
  if (!response.ok) throw new Error(`API health check failed: ${response.status}`);
  return response.json() as Promise<HealthResponse>;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { code?: string; message?: string };
  if (!response.ok) throw new ApiError(body.code ?? "REQUEST_FAILED", body.message ?? `Request failed: ${response.status}`);
  return body;
}

export function validateDataset(payload: unknown, contentType = "application/json"): Promise<ValidationResponse> {
  return requestJson("/datasets/validate", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: contentType === "text/csv" ? String(payload) : JSON.stringify(payload),
  });
}

export async function createPlanningRun(snapshotId: string): Promise<RunDetail> {
  const created = await requestJson<RunCreated>("/planning-runs", {
    method: "POST",
    body: JSON.stringify({ snapshot_id: snapshotId, ruleset_version: "Demo Ruleset v1" }),
  });
  return getPlanningRun(created.run_id);
}

/** Every persisted planning run, newest first. */
export function listPlanningRuns(): Promise<PlanningRunSummary[]> {
  return requestJson("/planning-runs");
}

export function getPlanningRun(runId: string): Promise<RunDetail> {
  return requestJson(`/planning-runs/${runId}`);
}

export async function lockScheduleItem(runId: string, jobId: string): Promise<RunDetail> {
  await requestJson(`/planning-runs/${runId}/lock`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, reason: "Planner accepted this block" }),
  });
  return getPlanningRun(runId);
}

export async function replanRun(
  runId: string,
  affectedSectionIds: string[],
  affectedWindowIds: string[],
): Promise<RunDetail> {
  const created = await requestJson<RunCreated>(`/planning-runs/${runId}/replan`, {
    method: "POST",
    body: JSON.stringify({
      affected_section_ids: affectedSectionIds,
      affected_window_ids: affectedWindowIds,
    }),
  });
  return getPlanningRun(created.run_id);
}

export async function approveRun(runId: string, reviewer: string, comment: string): Promise<RunDetail> {
  await requestJson(`/planning-runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({ reviewer, comment: comment || "Reviewed schedule and independent validator result" }),
  });
  return getPlanningRun(runId);
}

export function createRapidBlockRequest(payload: RapidBlockRequestPayload): Promise<RapidBlockResponse> {
  return requestJson("/rapidblock-requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getRapidBlockRequest(requestId: string): Promise<RapidBlockDetail> {
  return requestJson(`/rapidblock-requests/${requestId}`);
}

export async function downloadRun(runId: string): Promise<void> {
  const response = await fetch(`${apiUrl}/planning-runs/${runId}/export`);
  if (!response.ok) {
    const body = (await response.json()) as { code: string; message: string };
    throw new ApiError(body.code, body.message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `${runId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* --------------------------------------------------------------------------
 * RailRadar — live public train data (proxied and cached by our backend).
 * Optional context for planners; never a planning input.
 * ------------------------------------------------------------------------ */

export interface RailRadarEnvelope<T> {
  source: string;
  provider: string;
  fetched_at: string;
  from_cache: boolean;
  stale: boolean;
  data: T;
}

export interface LiveTrainStation {
  code: string;
  name: string;
  lat?: number;
  lng?: number;
}

export interface LiveTrainData {
  trainNumber: string;
  trainName: string;
  status: string;
  isLive: boolean;
  startDate: string;
  lastUpdatedAt: string;
  delayMinutes: number;
  train: {
    number: string;
    name: string;
    type: string;
    source: LiveTrainStation;
    destination: LiveTrainStation;
  };
  currentLocation: {
    stationCode: string;
    stationName: string;
    status: string;
    delayMinutes: number;
    distanceFromOriginKm: number;
  } | null;
  nextHalt?: { stationCode?: string; stationName?: string } | null;
  previousHalt?: { stationCode?: string; stationName?: string } | null;
}

/** Live running status for a 5-digit Indian Railways train number. */
export async function getLiveTrain(trainNumber: string): Promise<RailRadarEnvelope<LiveTrainData>> {
  const response = await fetch(`${apiUrl}/railradar/trains/${trainNumber}/live`);
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(
      "RAILRADAR_UNAVAILABLE",
      typeof body?.detail === "string" ? body.detail : `Live lookup failed (${response.status})`,
    );
  }
  return body as RailRadarEnvelope<LiveTrainData>;
}
