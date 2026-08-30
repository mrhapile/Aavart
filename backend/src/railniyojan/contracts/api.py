from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from railniyojan.contracts.enums import PlanningRunState, RapidBlockState
from railniyojan.contracts.models import Job, ScheduleItem


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidationIssue(ApiModel):
    code: str
    message: str
    field: str
    row: int | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class DatasetCounts(ApiModel):
    jobs: int = 0
    windows: int = 0
    assets: int = 0
    sections: int = 0
    resources: int = 0


class DatasetValidationResponse(ApiModel):
    valid: bool
    snapshot_candidate_id: str | None
    errors: list[ValidationIssue]
    counts: DatasetCounts


class PlanningRunCreateRequest(ApiModel):
    snapshot_id: str = Field(min_length=1)
    ruleset_version: str = Field(min_length=1)


class PlanningRunCreatedResponse(ApiModel):
    run_id: str
    state: PlanningRunState
    snapshot_id: str
    ruleset_version: str
    created_at: datetime
    status_url: str


class UnscheduledJob(ApiModel):
    job_id: str
    reason_codes: list[str] = Field(min_length=1)


class ValidatorSummary(ApiModel):
    passed: bool
    issues: list[dict[str, Any]] = Field(default_factory=list)
    validated_at: datetime


class ApprovalSummary(ApiModel):
    reviewer: str
    comment: str
    approved_at: datetime
    run_id: str
    snapshot_id: str
    ruleset_version: str


class JobContext(ApiModel):
    job_id: str
    department: str
    asset_id: str
    section_id: str
    work_type: str
    priority: int
    duration_minutes: int
    # Exposed so the frontend can construct a valid RapidBlock urgent_job for
    # this section without a separate "snapshot entities" endpoint - these
    # are real resource/window ids known to be valid for this job's section.
    required_resources: list[str]
    allowed_windows: list[str]


class KpiSummary(ApiModel):
    baseline_closure_minutes: int
    optimized_closure_minutes: int
    scheduled_maintenance_minutes: int
    rejected_maintenance_minutes: int
    baseline_asset_downtime_minutes: int
    optimized_asset_downtime_minutes: int
    downtime_reduction_minutes: int
    downtime_reduction_percent: float


class AiEstimate(ApiModel):
    job_id: str
    source: Literal["LOCAL_HEURISTIC", "DETERMINISTIC_FALLBACK"]
    priority: int
    duration_minutes: int
    duration_min_minutes: int
    duration_max_minutes: int
    reason_codes: list[str] = Field(min_length=1)


class PlanningRunSummary(ApiModel):
    """Lightweight archive row for GET /planning-runs.

    Deliberately excludes schedule_items/jobs/ai_estimates so listing the
    archive does not stream every job of every historical run.
    """

    run_id: str
    state: PlanningRunState
    snapshot_id: str
    ruleset_version: str
    created_at: datetime
    completed_at: datetime | None
    parent_run_id: str | None = None
    trigger_type: str
    total_job_count: int
    scheduled_job_count: int
    validator_passed: bool
    approval: ApprovalSummary | None = None
    kpis: KpiSummary | None = None


class PlanningRunDetail(ApiModel):
    run_id: str
    state: PlanningRunState
    snapshot_id: str
    snapshot_status: str
    ruleset_version: str
    created_at: datetime
    completed_at: datetime | None
    parent_run_id: str | None = None
    schedule_items: list[ScheduleItem]
    unscheduled_jobs: list[UnscheduledJob]
    jobs: list[JobContext]
    validator: ValidatorSummary
    approval: ApprovalSummary | None = None
    changes: dict[str, Literal["SCHEDULED", "REJECTED", "PRESERVED", "CHANGED"]]
    export_ready: bool
    kpis: KpiSummary
    ai_estimates: list[AiEstimate]


class LockResponse(ApiModel):
    run_id: str
    job_id: str
    locked: bool
    reason_codes: list[str]


class ApprovalResponse(ApiModel):
    run_id: str
    approved: bool
    approval: ApprovalSummary


class LockRequest(ApiModel):
    job_id: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ReplanRequest(ApiModel):
    affected_section_ids: list[str] = Field(min_length=1)
    affected_window_ids: list[str] = Field(min_length=1)


class ApprovalRequest(ApiModel):
    reviewer: str = Field(min_length=1)
    comment: str = Field(min_length=1)


class ErrorResponse(ApiModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class RapidBlockRequestCreate(ApiModel):
    base_run_id: str = Field(min_length=1)
    actor: str = Field(min_length=1)
    actor_role: Literal["PLANNER"]
    justification: str = Field(min_length=1)
    source_reported_at: datetime
    urgent_job: Job


class RapidBlockResponse(ApiModel):
    request_id: str
    state: RapidBlockState
    base_run_id: str
    base_snapshot_id: str
    derived_snapshot_id: str | None = None
    child_run_id: str | None = None
    reason_codes: list[str]
    status_url: str


class RapidBlockDetail(RapidBlockResponse):
    actor: str
    actor_role: str
    justification: str
    source_reported_at: datetime
    urgent_job: Job
    changed_jobs: dict[str, Literal["SCHEDULED", "REJECTED", "PRESERVED", "CHANGED"]]
    preserved_locked_jobs: list[str]
    validator: ValidatorSummary | None = None
    candidate_plan_status: PlanningRunState | None = None
