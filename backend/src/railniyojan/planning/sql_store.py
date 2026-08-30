from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from railniyojan.contracts.api import AiEstimate, ApprovalSummary, KpiSummary
from railniyojan.contracts.enums import PlanningRunState, RapidBlockState
from railniyojan.contracts.models import DatasetPayload, Job, ScheduleItem
from railniyojan.db.models import (
    Approval,
    AuditEvent,
    PlanningRun,
    RapidBlockRequest,
    ScheduleItemRecord,
    Snapshot,
    ValidatorResult,
)
from railniyojan.db.models import (
    ExportRecord as ExportRow,
)
from railniyojan.planning.store import (
    AuditEventRecord,
    ExportRecord,
    RapidBlockRecord,
    RunRecord,
    RunSummaryRecord,
    SnapshotRecord,
)


def _with_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class SqlAlchemyPlanningStore:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

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
        with self._session_factory.begin() as session:
            existing = session.get(Snapshot, snapshot_id)
            if existing is None:
                session.add(
                    Snapshot(
                        id=snapshot_id,
                        parent_snapshot_id=parent_snapshot_id,
                        derivation_type=derivation_type,
                        derived_from_request_id=derived_from_request_id,
                        source_hash=source_hash,
                        status="VALID",
                        created_by=created_by,
                        schema_version=dataset.schema_version,
                        raw_metadata={"dataset": dataset.model_dump(mode="json")},
                    )
                )
            session.flush()
            return self._snapshot_record(session.get_one(Snapshot, snapshot_id))

    def get_snapshot(self, snapshot_id: str) -> SnapshotRecord | None:
        with self._session_factory() as session:
            row = session.get(Snapshot, snapshot_id)
            return self._snapshot_record(row) if row is not None else None

    def set_snapshot_status(self, snapshot_id: str, status: str) -> None:
        with self._session_factory.begin() as session:
            session.get_one(Snapshot, snapshot_id).status = status

    def save_run(self, run: RunRecord) -> RunRecord:
        with self._session_factory.begin() as session:
            self._upsert_run(session, run)
            return deepcopy(run)

    def get_run(self, run_id: str) -> RunRecord | None:
        with self._session_factory() as session:
            row = session.get(PlanningRun, run_id)
            return self._run_record(session, row) if row is not None else None

    def update_run(self, run: RunRecord) -> RunRecord:
        with self._session_factory.begin() as session:
            if session.get(PlanningRun, run.run_id) is None:
                raise KeyError(run.run_id)
            self._upsert_run(session, run)
            return deepcopy(run)

    def list_runs(self) -> list[RunSummaryRecord]:
        """Newest-first archive rows.

        Reads only the run header plus three aggregate lookups - the schedule
        items themselves are never loaded, so the archive list stays cheap
        regardless of how many jobs each historical run carries.
        """
        with self._session_factory() as session:
            rows = session.scalars(
                select(PlanningRun).order_by(PlanningRun.created_at.desc(), PlanningRun.id.desc())
            ).all()
            if not rows:
                return []
            run_ids = [row.id for row in rows]
            scheduled_counts: dict[str, int] = dict(
                session.execute(
                    select(ScheduleItemRecord.run_id, func.count())
                    .where(ScheduleItemRecord.run_id.in_(run_ids))
                    .group_by(ScheduleItemRecord.run_id)
                )
                .tuples()
                .all()
            )
            validator_passed: dict[str, bool] = dict(
                session.execute(
                    select(ValidatorResult.run_id, ValidatorResult.passed).where(
                        ValidatorResult.run_id.in_(run_ids)
                    )
                )
                .tuples()
                .all()
            )
            approvals = {
                approval.run_id: approval
                for approval in session.scalars(
                    select(Approval).where(Approval.run_id.in_(run_ids))
                ).all()
            }
            summaries: list[RunSummaryRecord] = []
            for row in rows:
                metadata = row.raw_metadata
                changes: dict[str, str] = metadata.get("changes", {})
                scheduled = int(scheduled_counts.get(row.id, 0))
                approval_row = approvals.get(row.id)
                summaries.append(
                    RunSummaryRecord(
                        run_id=row.id,
                        snapshot_id=row.snapshot_id,
                        ruleset_version=row.ruleset_version,
                        state=PlanningRunState(row.state),
                        created_at=_with_utc(row.created_at),
                        completed_at=_with_utc(row.completed_at)
                        if row.completed_at is not None
                        else None,
                        parent_run_id=row.parent_run_id,
                        trigger_type=row.trigger_type,
                        total_job_count=len(changes)
                        or scheduled + len(metadata.get("unscheduled_reason_codes", {})),
                        scheduled_job_count=scheduled,
                        validator_passed=bool(validator_passed.get(row.id, False)),
                        approval=ApprovalSummary(
                            reviewer=approval_row.reviewer,
                            comment=approval_row.comment,
                            approved_at=_with_utc(approval_row.approved_at),
                            run_id=row.id,
                            snapshot_id=row.snapshot_id,
                            ruleset_version=row.ruleset_version,
                        )
                        if approval_row is not None
                        else None,
                        kpis=KpiSummary.model_validate(metadata["kpis"])
                        if metadata.get("kpis")
                        else None,
                    )
                )
            return summaries

    def save_rapidblock_request(self, record: RapidBlockRecord) -> RapidBlockRecord:
        with self._session_factory.begin() as session:
            row = session.get(RapidBlockRequest, record.request_id)
            if row is None:
                row = RapidBlockRequest(
                    id=record.request_id,
                    base_run_id=record.base_run_id,
                    base_snapshot_id=record.base_snapshot_id,
                    actor=record.actor,
                    actor_role=record.actor_role,
                    justification=record.justification,
                    source_reported_at=record.source_reported_at,
                    urgent_job_id=record.urgent_job.job_id,
                    state=record.state.value,
                    reason_codes=record.reason_codes,
                    request_payload=record.urgent_job.model_dump(mode="json"),
                    changed_jobs=record.changed_jobs,
                    preserved_locked_jobs=record.preserved_locked_jobs,
                )
                session.add(row)
            row.derived_snapshot_id = record.derived_snapshot_id
            row.child_run_id = record.child_run_id
            row.state = record.state.value
            row.reason_codes = record.reason_codes
            row.changed_jobs = record.changed_jobs
            row.preserved_locked_jobs = record.preserved_locked_jobs
            row.updated_at = datetime.now(UTC)
            return deepcopy(record)

    def get_rapidblock_request(self, request_id: str) -> RapidBlockRecord | None:
        with self._session_factory() as session:
            row = session.get(RapidBlockRequest, request_id)
            if row is None:
                return None
            return RapidBlockRecord(
                request_id=row.id,
                base_run_id=row.base_run_id,
                base_snapshot_id=row.base_snapshot_id,
                actor=row.actor,
                actor_role=row.actor_role,
                justification=row.justification,
                source_reported_at=_with_utc(row.source_reported_at),
                urgent_job=Job.model_validate(row.request_payload),
                state=RapidBlockState(row.state),
                reason_codes=row.reason_codes,
                derived_snapshot_id=row.derived_snapshot_id,
                child_run_id=row.child_run_id,
                changed_jobs=row.changed_jobs,
                preserved_locked_jobs=row.preserved_locked_jobs,
                created_at=_with_utc(row.created_at),
                updated_at=_with_utc(row.updated_at),
            )

    def add_audit_event(self, event: AuditEventRecord) -> AuditEventRecord:
        with self._session_factory.begin() as session:
            session.add(
                AuditEvent(
                    id=event.event_id,
                    entity_type=event.entity_type,
                    entity_id=event.entity_id,
                    event_type=event.event_type,
                    actor=event.actor,
                    metadata_json=event.metadata,
                )
            )
            return deepcopy(event)

    def list_audit_events(self) -> list[AuditEventRecord]:
        with self._session_factory() as session:
            rows = session.scalars(select(AuditEvent).order_by(AuditEvent.created_at)).all()
            return [
                AuditEventRecord(
                    event_id=row.id,
                    entity_type=row.entity_type,
                    entity_id=row.entity_id,
                    event_type=row.event_type,
                    actor=row.actor,
                    metadata=row.metadata_json,
                    created_at=_with_utc(row.created_at),
                )
                for row in rows
            ]

    def add_export(self, record: ExportRecord) -> ExportRecord:
        with self._session_factory.begin() as session:
            session.add(
                ExportRow(
                    id=record.export_id,
                    run_id=record.run_id,
                    format=record.format,
                    created_by=record.created_by,
                )
            )
            return deepcopy(record)

    def list_exports(self) -> list[ExportRecord]:
        with self._session_factory() as session:
            rows = session.scalars(select(ExportRow).order_by(ExportRow.created_at)).all()
            return [
                ExportRecord(
                    export_id=row.id,
                    run_id=row.run_id,
                    format=row.format,
                    created_by=row.created_by,
                    created_at=_with_utc(row.created_at),
                )
                for row in rows
            ]

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
        with self._session_factory.begin() as session:
            for table in (
                ValidatorResult,
                ScheduleItemRecord,
                ExportRow,
                Approval,
                RapidBlockRequest,
                PlanningRun,
                Snapshot,
                AuditEvent,
            ):
                session.execute(delete(table))

    @staticmethod
    def _snapshot_record(row: Snapshot) -> SnapshotRecord:
        return SnapshotRecord(
            snapshot_id=row.id,
            dataset=DatasetPayload.model_validate(row.raw_metadata["dataset"]),
            source_hash=row.source_hash,
            status=row.status,
            created_at=_with_utc(row.created_at),
            parent_snapshot_id=row.parent_snapshot_id,
            derivation_type=row.derivation_type,
            derived_from_request_id=row.derived_from_request_id,
            created_by=row.created_by,
        )

    def _upsert_run(self, session: Session, run: RunRecord) -> None:
        metadata = {
            "unscheduled_reason_codes": run.unscheduled_reason_codes,
            "changes": run.changes,
            "kpis": run.kpis.model_dump(mode="json") if run.kpis else None,
            "ai_estimates": [item.model_dump(mode="json") for item in run.ai_estimates],
        }
        row = session.get(PlanningRun, run.run_id)
        if row is None:
            row = PlanningRun(
                id=run.run_id,
                snapshot_id=run.snapshot_id,
                parent_run_id=run.parent_run_id,
                trigger_type=run.trigger_type,
                rapidblock_request_id=run.rapidblock_request_id,
                ruleset_version=run.ruleset_version,
                state=run.state.value,
                deterministic_seed=26027,
                completed_at=run.completed_at,
                raw_metadata=metadata,
            )
            session.add(row)
        row.state = run.state.value
        row.parent_run_id = run.parent_run_id
        row.trigger_type = run.trigger_type
        row.rapidblock_request_id = run.rapidblock_request_id
        row.completed_at = run.completed_at
        row.raw_metadata = metadata
        session.execute(delete(ScheduleItemRecord).where(ScheduleItemRecord.run_id == run.run_id))
        for item in run.schedule_items:
            session.add(
                ScheduleItemRecord(
                    id=f"{run.run_id}:{item.job_id}",
                    run_id=run.run_id,
                    job_id=item.job_id,
                    window_id=item.window_id,
                    start_at=item.start,
                    end_at=item.end,
                    status=item.status.value,
                    locked=item.locked,
                    reason_codes=item.reason_codes,
                )
            )
        validator = session.scalar(
            select(ValidatorResult).where(ValidatorResult.run_id == run.run_id)
        )
        if validator is None:
            validator = ValidatorResult(
                id=f"VAL-{run.run_id}",
                run_id=run.run_id,
                passed=run.validator_passed,
                issues=run.validator_issues,
                validated_at=run.validated_at,
            )
            session.add(validator)
        validator.passed = run.validator_passed
        validator.issues = run.validator_issues
        validator.validated_at = run.validated_at
        if run.approval is not None and session.scalar(
            select(Approval).where(Approval.run_id == run.run_id)
        ) is None:
            session.add(
                Approval(
                    id=f"APP-{run.run_id}",
                    run_id=run.run_id,
                    reviewer=run.approval.reviewer,
                    comment=run.approval.comment,
                    approved_at=run.approval.approved_at,
                )
            )

    @staticmethod
    def _run_record(session: Session, row: PlanningRun) -> RunRecord:
        metadata = row.raw_metadata
        approval_row = session.scalar(select(Approval).where(Approval.run_id == row.id))
        validator = session.scalar(select(ValidatorResult).where(ValidatorResult.run_id == row.id))
        items = session.scalars(
            select(ScheduleItemRecord)
            .where(ScheduleItemRecord.run_id == row.id)
            .order_by(ScheduleItemRecord.start_at, ScheduleItemRecord.job_id)
        ).all()
        return RunRecord(
            run_id=row.id,
            snapshot_id=row.snapshot_id,
            ruleset_version=row.ruleset_version,
            state=PlanningRunState(row.state),
            created_at=_with_utc(row.created_at),
            completed_at=_with_utc(row.completed_at) if row.completed_at is not None else None,
            schedule_items=[
                ScheduleItem(
                    job_id=item.job_id,
                    window_id=item.window_id,
                    start=_with_utc(item.start_at),
                    end=_with_utc(item.end_at),
                    status=item.status,
                    locked=item.locked,
                    reason_codes=item.reason_codes,
                )
                for item in items
            ],
            unscheduled_reason_codes=metadata.get("unscheduled_reason_codes", {}),
            validator_passed=validator.passed if validator is not None else False,
            validator_issues=validator.issues if validator is not None else [],
            validated_at=_with_utc(validator.validated_at)
            if validator is not None
            else _with_utc(row.created_at),
            parent_run_id=row.parent_run_id,
            rapidblock_request_id=row.rapidblock_request_id,
            trigger_type=row.trigger_type,
            approval=ApprovalSummary(
                reviewer=approval_row.reviewer,
                comment=approval_row.comment,
                approved_at=_with_utc(approval_row.approved_at),
                run_id=row.id,
                snapshot_id=row.snapshot_id,
                ruleset_version=row.ruleset_version,
            )
            if approval_row is not None
            else None,
            changes=metadata.get("changes", {}),
            kpis=KpiSummary.model_validate(metadata["kpis"]) if metadata.get("kpis") else None,
            ai_estimates=[
                AiEstimate.model_validate(item) for item in metadata.get("ai_estimates", [])
            ],
        )
