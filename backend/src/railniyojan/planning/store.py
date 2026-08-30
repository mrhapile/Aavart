from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import RLock
from typing import Any
from uuid import uuid4

from railniyojan.contracts.api import AiEstimate, ApprovalSummary, KpiSummary
from railniyojan.contracts.enums import PlanningRunState, RapidBlockState
from railniyojan.contracts.models import DatasetPayload, Job, ScheduleItem


@dataclass
class SnapshotRecord:
    snapshot_id: str
    dataset: DatasetPayload
    source_hash: str
    status: str = "VALID"
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    parent_snapshot_id: str | None = None
    derivation_type: str | None = None
    derived_from_request_id: str | None = None
    created_by: str = "system"


@dataclass
class RunRecord:
    run_id: str
    snapshot_id: str
    ruleset_version: str
    state: PlanningRunState
    created_at: datetime
    completed_at: datetime | None
    schedule_items: list[ScheduleItem]
    unscheduled_reason_codes: dict[str, list[str]]
    validator_passed: bool
    validator_issues: list[dict[str, object]]
    validated_at: datetime
    parent_run_id: str | None = None
    rapidblock_request_id: str | None = None
    trigger_type: str = "BASELINE"
    approval: ApprovalSummary | None = None
    changes: dict[str, str] = field(default_factory=dict)
    kpis: KpiSummary | None = None
    ai_estimates: list[AiEstimate] = field(default_factory=list)


@dataclass
class RunSummaryRecord:
    """Archive-list projection of a run - no schedule items, jobs or estimates."""

    run_id: str
    snapshot_id: str
    ruleset_version: str
    state: PlanningRunState
    created_at: datetime
    completed_at: datetime | None
    parent_run_id: str | None
    trigger_type: str
    total_job_count: int
    scheduled_job_count: int
    validator_passed: bool
    approval: ApprovalSummary | None = None
    kpis: KpiSummary | None = None


@dataclass
class RapidBlockRecord:
    request_id: str
    base_run_id: str
    base_snapshot_id: str
    actor: str
    actor_role: str
    justification: str
    source_reported_at: datetime
    urgent_job: Job
    state: RapidBlockState
    reason_codes: list[str]
    derived_snapshot_id: str | None = None
    child_run_id: str | None = None
    changed_jobs: dict[str, str] = field(default_factory=dict)
    preserved_locked_jobs: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class AuditEventRecord:
    event_id: str
    entity_type: str
    entity_id: str
    event_type: str
    actor: str
    metadata: dict[str, object] = field(default_factory=dict)
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class ExportRecord:
    export_id: str
    run_id: str
    format: str
    created_by: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def summarize_run(run: RunRecord) -> RunSummaryRecord:
    """Projects a full RunRecord onto the lightweight archive row."""
    total = len(run.changes) or (len(run.schedule_items) + len(run.unscheduled_reason_codes))
    return RunSummaryRecord(
        run_id=run.run_id,
        snapshot_id=run.snapshot_id,
        ruleset_version=run.ruleset_version,
        state=run.state,
        created_at=run.created_at,
        completed_at=run.completed_at,
        parent_run_id=run.parent_run_id,
        trigger_type=run.trigger_type,
        total_job_count=total,
        scheduled_job_count=len(run.schedule_items),
        validator_passed=run.validator_passed,
        approval=run.approval,
        kpis=run.kpis,
    )


class PlanningStore:
    def __init__(self) -> None:
        self._snapshots: dict[str, SnapshotRecord] = {}
        self._runs: dict[str, RunRecord] = {}
        self._rapidblock_requests: dict[str, RapidBlockRecord] = {}
        self._audit_events: list[AuditEventRecord] = []
        self._exports: list[ExportRecord] = []
        self._lock = RLock()

    def register_snapshot(
        self,
        snapshot_id: str,
        source_hash: str,
        dataset: DatasetPayload,
        *,
        parent_snapshot_id: str | None = None,
        derivation_type: str | None = None,
        derived_from_request_id: str | None = None,
        created_by: str = "system",
    ) -> SnapshotRecord:
        with self._lock:
            existing = self._snapshots.get(snapshot_id)
            if existing is not None:
                return deepcopy(existing)
            record = SnapshotRecord(
                snapshot_id=snapshot_id,
                dataset=deepcopy(dataset),
                source_hash=source_hash,
                parent_snapshot_id=parent_snapshot_id,
                derivation_type=derivation_type,
                derived_from_request_id=derived_from_request_id,
                created_by=created_by,
            )
            self._snapshots[snapshot_id] = record
            return deepcopy(record)

    def get_snapshot(self, snapshot_id: str) -> SnapshotRecord | None:
        with self._lock:
            record = self._snapshots.get(snapshot_id)
            return deepcopy(record) if record else None

    def set_snapshot_status(self, snapshot_id: str, status: str) -> None:
        with self._lock:
            self._snapshots[snapshot_id].status = status

    def save_run(self, run: RunRecord) -> RunRecord:
        with self._lock:
            self._runs[run.run_id] = deepcopy(run)
            return deepcopy(run)

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._lock:
            record = self._runs.get(run_id)
            return deepcopy(record) if record else None

    def update_run(self, run: RunRecord) -> RunRecord:
        with self._lock:
            if run.run_id not in self._runs:
                raise KeyError(run.run_id)
            self._runs[run.run_id] = deepcopy(run)
            return deepcopy(run)

    def list_runs(self) -> list[RunSummaryRecord]:
        with self._lock:
            summaries = [summarize_run(run) for run in self._runs.values()]
        summaries.sort(key=lambda summary: (summary.created_at, summary.run_id), reverse=True)
        return summaries

    def save_rapidblock_request(self, record: RapidBlockRecord) -> RapidBlockRecord:
        with self._lock:
            record.updated_at = datetime.now(UTC)
            self._rapidblock_requests[record.request_id] = deepcopy(record)
            return deepcopy(record)

    def get_rapidblock_request(self, request_id: str) -> RapidBlockRecord | None:
        with self._lock:
            record = self._rapidblock_requests.get(request_id)
            return deepcopy(record) if record else None

    def add_audit_event(self, event: AuditEventRecord) -> AuditEventRecord:
        with self._lock:
            self._audit_events.append(deepcopy(event))
            return deepcopy(event)

    def list_audit_events(self) -> list[AuditEventRecord]:
        with self._lock:
            return deepcopy(self._audit_events)

    def add_export(self, record: ExportRecord) -> ExportRecord:
        with self._lock:
            self._exports.append(deepcopy(record))
            return deepcopy(record)

    def list_exports(self) -> list[ExportRecord]:
        with self._lock:
            return deepcopy(self._exports)

    @staticmethod
    def next_run_id() -> str:
        return f"RUN-{uuid4().hex[:12].upper()}"

    @staticmethod
    def next_request_id() -> str:
        return f"RB-{uuid4().hex[:12].upper()}"

    @staticmethod
    def next_event_id() -> str:
        return f"AUD-{uuid4().hex[:12].upper()}"

    @staticmethod
    def next_export_id() -> str:
        return f"EXP-{uuid4().hex[:12].upper()}"

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()
            self._runs.clear()
            self._rapidblock_requests.clear()
            self._audit_events.clear()
            self._exports.clear()


def _create_planning_store() -> Any:
    from railniyojan.api.settings import get_settings

    settings = get_settings()
    if settings.store_backend == "sql":
        from railniyojan.db.session import SessionFactory
        from railniyojan.planning.sql_store import SqlAlchemyPlanningStore

        return SqlAlchemyPlanningStore(SessionFactory)
    return PlanningStore()


planning_store: Any = _create_planning_store()
