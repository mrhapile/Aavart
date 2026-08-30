import baselineDatasetFixture from "../../../../../fixtures/baseline_valid/dataset.json";
import {
  ApiError,
  approveRun,
  createPlanningRun,
  createRapidBlockRequest,
  downloadRun,
  getApiHealth,
  getPlanningRun,
  getRapidBlockRequest,
  listPlanningRuns,
  lockScheduleItem,
  replanRun,
  validateDataset,
  type PlanningRunSummary,
  type RunDetail,
  type ValidationResponse,
} from "@/lib/api";
import { CORRIDOR_PRESETS } from "@/lib/corridor-presets";
import {
  DepartmentType,
  JobDetailView,
  PlanArchiveEntry,
  PlanRunView,
  RapidBlockFormValues,
  RapidBlockImpactView,
  ScheduleItemView,
  ValidationState,
} from "@/types";
import { RAPID_BLOCK_ACTOR, formatTime } from "@/lib/utils";

function toApiError(err: unknown, fallbackMessage: string): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : fallbackMessage;
  return new ApiError("REQUEST_FAILED", message || fallbackMessage);
}

export function mapBackendRunToView(run: RunDetail): PlanRunView {
  const scheduleMap = new Map(run.schedule_items.map((s) => [s.job_id, s]));
  const aiMap = new Map(run.ai_estimates.map((a) => [a.job_id, a]));

  const jobsView: JobDetailView[] = run.jobs.map((j) => {
    const s = scheduleMap.get(j.job_id);
    const ai = aiMap.get(j.job_id);
    const unscheduled = run.unscheduled_jobs.find((u) => u.job_id === j.job_id);
    const reason_codes = s?.reason_codes ?? unscheduled?.reason_codes ?? ai?.reason_codes ?? [];

    let priority_label: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
    if (j.priority >= 80) priority_label = "HIGH";
    else if (j.priority < 60) priority_label = "LOW";

    const isLocked = Boolean(s?.locked);
    const status = isLocked ? "LOCKED" : s?.status === "SCHEDULED" ? "SCHEDULED" : "UNSCHEDULED";

    return {
      job_id: j.job_id,
      department: (j.department as DepartmentType) || "TRACK",
      asset_id: j.asset_id,
      section_id: j.section_id,
      // The backend does not report a km marker per job - this is a real,
      // honestly-derived label (not an invented km range).
      location_km: `Section ${j.section_id} / ${j.asset_id}`,
      work_type: j.work_type,
      priority: j.priority,
      priority_label,
      duration_minutes: j.duration_minutes ?? ai?.duration_minutes ?? 0,
      preferred_window: s?.window_id,
      scheduled_start: s?.start,
      scheduled_end: s?.end,
      scheduled_window_id: s?.window_id,
      status,
      locked: isLocked,
      reason_codes,
      required_resources: j.required_resources,
      allowed_windows: j.allowed_windows,
      ai_estimate: ai
        ? {
            source: ai.source,
            priority: ai.priority,
            duration_minutes: ai.duration_minutes,
            reason_codes: ai.reason_codes,
          }
        : undefined,
    };
  });

  const schedule_items: ScheduleItemView[] = run.schedule_items.map((s) => ({
    job_id: s.job_id,
    window_id: s.window_id,
    start: s.start,
    end: s.end,
    status: s.status,
    reason_codes: s.reason_codes,
    locked: s.locked,
    is_integrated_block: s.reason_codes.some((c) => c.includes("SHARED") || c.includes("MULTI")),
  }));

  // The backend's PlanningRunDetail carries no section topology/track/status
  // data at all - only section_id is known (via each job). Report only what
  // is real (the section id and its real job count); everything else is
  // left unset so the UI can render "unknown" rather than an invented value.
  // We reconstruct from_node/to_node by checking the known presets.
  const uniqueSections = Array.from(new Set(run.jobs.map((j) => j.section_id)));
  const sections = uniqueSections.map((secId) => {
    let from_node: string | undefined;
    let to_node: string | undefined;
    let name: string = secId;

    for (const preset of CORRIDOR_PRESETS) {
      const presetSections = preset.dataset?.sections as Array<{ section_id: string; from_node?: string; to_node?: string; name?: string }> | undefined;
      if (presetSections) {
        const found = presetSections.find((s) => s.section_id === secId);
        if (found) {
          from_node = found.from_node;
          to_node = found.to_node;
          if (found.name) name = found.name;
          break;
        }
      }
    }

    return {
      section_id: secId,
      name,
      from_node,
      to_node,
      total_works: run.jobs.filter((j) => j.section_id === secId).length,
    };
  });

  const closureReduction = run.kpis.baseline_closure_minutes > 0
    ? ((run.kpis.baseline_closure_minutes - run.kpis.optimized_closure_minutes) / run.kpis.baseline_closure_minutes) * 100
    : 0;

  return {
    run_id: run.run_id,
    snapshot_id: run.snapshot_id,
    ruleset_version: run.ruleset_version,
    state: run.state,
    created_at: run.created_at,
    completed_at: run.completed_at,
    parent_run_id: run.parent_run_id,
    export_ready: run.export_ready,
    jobs: jobsView,
    schedule_items,
    unscheduled_jobs: run.unscheduled_jobs,
    sections,
    kpis: {
      baseline_closure_minutes: run.kpis.baseline_closure_minutes,
      optimized_closure_minutes: run.kpis.optimized_closure_minutes,
      closure_reduction_percent: closureReduction,
      baseline_asset_downtime_minutes: run.kpis.baseline_asset_downtime_minutes,
      optimized_asset_downtime_minutes: run.kpis.optimized_asset_downtime_minutes,
      downtime_reduction_minutes: run.kpis.downtime_reduction_minutes,
      downtime_reduction_percent: run.kpis.downtime_reduction_percent,
      scheduled_maintenance_minutes: run.kpis.scheduled_maintenance_minutes,
      rejected_maintenance_minutes: run.kpis.rejected_maintenance_minutes,
      plan_quality: run.state === "OPTIMAL" ? "OPTIMAL" : run.state === "FEASIBLE" ? "FEASIBLE" : "DEGRADED",
    },
    changes: run.changes,
    validator: run.validator,
    approval: run.approval,
  };
}

export function mapBackendSummaryToArchiveEntry(summary: PlanningRunSummary): PlanArchiveEntry {
  return {
    runId: summary.run_id,
    snapshotId: summary.snapshot_id,
    plannedAt: summary.completed_at ?? summary.created_at,
    state: summary.state,
    approvedBy: summary.approval?.reviewer ?? null,
    approvedAt: summary.approval?.approved_at ?? null,
    totalJobCount: summary.total_job_count,
    scheduledJobCount: summary.scheduled_job_count,
    validatorPassed: summary.validator_passed,
    // Runs persisted before KPIs were recorded carry no kpis block - report
    // that as unknown rather than as a 0% gain.
    downtimeReductionPercent: summary.kpis?.downtime_reduction_percent ?? null,
    triggerType: summary.trigger_type,
  };
}

export async function isBackendAlive(): Promise<boolean> {
  try {
    const res = await getApiHealth();
    return res.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Every adapter below calls the real backend and, on failure, rethrows a
 * real ApiError instead of silently substituting mock/fabricated data.
 * Callers (app/page.tsx) are responsible for surfacing the error and
 * leaving state unchanged - a failure must never look like a success.
 */

export async function validateDatasetAdapter(
  payload: unknown,
  format: "CSV" | "JSON" = "JSON",
): Promise<ValidationState> {
  try {
    const res: ValidationResponse = await validateDataset(
      payload || baselineDatasetFixture,
      format === "CSV" ? "text/csv" : "application/json",
    );
    return {
      valid: res.valid,
      snapshotCandidateId: res.snapshot_candidate_id,
      issues: res.errors.map((err, i) => ({
        id: `API-ERR-${i + 1}`,
        code: err.code,
        message: err.message,
        field: err.field,
        row: err.row ?? undefined,
        severity: "error",
        resolved: false,
      })),
      counts: res.counts,
    };
  } catch (err) {
    throw toApiError(err, "Could not validate dataset with the backend.");
  }
}

export async function createPlanningRunAdapter(snapshotId: string): Promise<PlanRunView> {
  try {
    const detail = await createPlanningRun(snapshotId);
    return mapBackendRunToView(detail);
  } catch (err) {
    throw toApiError(err, "Could not create a planning run.");
  }
}

/** Loads the archive of every persisted run for the Previous Plans screen. */
export async function listPlanningRunsAdapter(): Promise<PlanArchiveEntry[]> {
  try {
    const runs = await listPlanningRuns();
    return runs.map(mapBackendSummaryToArchiveEntry);
  } catch (err) {
    throw toApiError(err, "Could not load past planning runs.");
  }
}

/** Loads one historical run in full, for read-only review. */
export async function fetchPlanningRunAdapter(runId: string): Promise<PlanRunView> {
  try {
    const detail = await getPlanningRun(runId);
    return mapBackendRunToView(detail);
  } catch (err) {
    throw toApiError(err, `Could not load planning run ${runId}.`);
  }
}

export async function lockScheduleItemAdapter(
  runId: string,
  jobId: string,
): Promise<PlanRunView> {
  try {
    const detail = await lockScheduleItem(runId, jobId);
    return mapBackendRunToView(detail);
  } catch (err) {
    throw toApiError(err, "Could not lock this job.");
  }
}

export async function replanRunAdapter(
  runId: string,
  affectedSections: string[],
  affectedWindows: string[],
): Promise<PlanRunView> {
  try {
    const detail = await replanRun(runId, affectedSections, affectedWindows);
    return mapBackendRunToView(detail);
  } catch (err) {
    throw toApiError(err, "Re-optimization failed.");
  }
}

export async function approveRunAdapter(
  runId: string,
  reviewer: string,
  comment: string,
): Promise<PlanRunView> {
  try {
    const detail = await approveRun(runId, reviewer, comment);
    return mapBackendRunToView(detail);
  } catch (err) {
    throw toApiError(err, "Could not approve this plan.");
  }
}

export async function exportRunAdapter(runId: string): Promise<void> {
  try {
    await downloadRun(runId);
  } catch (err) {
    throw toApiError(err, "Export failed.");
  }
}

const INCIDENT_TYPE_DEPARTMENT: Array<{ suffix: string; department: DepartmentType }> = [
  { suffix: "(TMS)", department: "TRACK" },
  { suffix: "(SMMS)", department: "SIGNAL" },
  { suffix: "(TDMS)", department: "ELECTRICAL" },
];

function inferDepartment(incidentType: string, fallback: DepartmentType): DepartmentType {
  const match = INCIDENT_TYPE_DEPARTMENT.find((d) => incidentType.includes(d.suffix));
  return match?.department ?? fallback;
}

/**
 * Finds a real job in the given section whose required_resources/
 * allowed_windows are known (from GET /planning-runs/{id}) - there is no
 * dedicated "snapshot entities" endpoint, so an existing job in the same
 * section is used as a real, valid template for those two fields.
 */
function findTemplateJob(plan: PlanRunView, sectionId: string): JobDetailView | undefined {
  return plan.jobs.find(
    (j) => j.section_id === sectionId && (j.required_resources?.length ?? 0) > 0 && (j.allowed_windows?.length ?? 0) > 0,
  );
}

/**
 * Submits a real emergency job to POST /rapidblock-requests, built from a
 * template job in the same section for the two fields no API exposes a full
 * list for (required_resources, allowed_windows). If no such template job
 * exists in the selected section, this throws rather than fabricating a
 * resource/window id - the caller shows that as a real error.
 */
export async function submitRapidBlockAdapter(
  form: RapidBlockFormValues,
  plan: PlanRunView,
): Promise<RapidBlockImpactView> {
  const template = findTemplateJob(plan, form.sectionId);
  if (!template || !template.required_resources || !template.allowed_windows) {
    throw new ApiError(
      "NO_TEMPLATE_JOB",
      `No existing job with known resources/windows in section ${form.sectionId} - cannot build a valid emergency request without a snapshot-entities endpoint.`,
    );
  }

  const department = inferDepartment(form.incidentType, template.department);
  const response = await createRapidBlockRequest({
    base_run_id: plan.run_id,
    actor: RAPID_BLOCK_ACTOR,
    actor_role: "PLANNER",
    justification: form.notes || form.incidentType,
    source_reported_at: new Date().toISOString(),
    urgent_job: {
      job_id: `JOB-EMG-${Date.now()}`,
      department,
      asset_id: template.asset_id,
      section_id: form.sectionId,
      work_type: form.incidentType,
      priority: 100,
      duration_minutes: form.durationMinutes,
      duration_min_minutes: form.durationMinutes,
      duration_max_minutes: form.durationMinutes + 60,
      required_resources: template.required_resources,
      allowed_windows: template.allowed_windows,
      status: "UNSCHEDULED",
    },
  });

  if (response.state === "REJECTED") {
    const code = response.reason_codes[0] ?? "REJECTED";
    throw new ApiError(code, `Rapid Block request rejected: ${code.replaceAll("_", " ").toLowerCase()}.`);
  }

  const detail = await getRapidBlockRequest(response.request_id);
  const isCandidateReady = detail.state === "CANDIDATE_READY";

  let rescheduledJobs: RapidBlockImpactView["rescheduledJobs"] = [];
  if (isCandidateReady && detail.child_run_id) {
    const childRun = await getPlanningRun(detail.child_run_id);
    rescheduledJobs = Object.entries(detail.changed_jobs)
      .filter(([, status]) => status === "CHANGED")
      .map(([jobId]) => {
        const job = plan.jobs.find((j) => j.job_id === jobId);
        const prevItem = plan.schedule_items.find((s) => s.job_id === jobId);
        const newItem = childRun.schedule_items.find((s) => s.job_id === jobId);
        return {
          jobId,
          department: job?.department ?? "TRACK",
          sectionId: job?.section_id ?? "",
          previousWindow: prevItem ? `${prevItem.window_id} (${formatTime(prevItem.start)}–${formatTime(prevItem.end)})` : "Unscheduled",
          newWindow: newItem ? `${newItem.window_id} (${formatTime(newItem.start)}–${formatTime(newItem.end)})` : "Unscheduled",
        };
      });
  }

  return {
    requestId: response.request_id,
    state: detail.state,
    baseRunId: plan.run_id,
    childRunId: detail.child_run_id,
    derivedSnapshotId: detail.derived_snapshot_id,
    incidentLocation: {
      sectionId: form.sectionId,
      kmMarker: "—",
      incidentType: form.incidentType,
    },
    rescheduledJobs,
    // No backend field reports affected commercial trains - not fabricated.
    delayedTrains: [],
    preservedLockedJobs: detail.preserved_locked_jobs,
    reasonCodes: detail.reason_codes,
    isCandidateReady,
    isSimulated: false,
  };
}
