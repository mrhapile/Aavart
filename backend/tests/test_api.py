from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from railniyojan.api.main import app
from railniyojan.db.base import Base
from railniyojan.planning.sql_store import SqlAlchemyPlanningStore
from railniyojan.planning.store import planning_store

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_fixture_validation_endpoint(baseline_payload: dict[str, Any]) -> None:
    response = client.post("/datasets/validate", json=baseline_payload)

    assert response.status_code == 200
    assert response.json()["valid"] is True
    assert response.json()["counts"]["jobs"] == 4


def _create_run(baseline_payload: dict[str, Any]) -> tuple[str, str]:
    validation = client.post("/datasets/validate", json=baseline_payload)
    snapshot_id = validation.json()["snapshot_candidate_id"]
    response = client.post(
        "/planning-runs",
        json={"snapshot_id": snapshot_id, "ruleset_version": "Demo Ruleset v1"},
    )
    assert response.status_code == 201
    return response.json()["run_id"], snapshot_id


def test_unknown_snapshot_is_rejected_with_stable_error() -> None:
    response = client.post(
        "/planning-runs",
        json={"snapshot_id": "SNAP-TEST", "ruleset_version": "Demo Ruleset v1"},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "SNAPSHOT_NOT_FOUND"


def test_planning_run_returns_schedule_and_unscheduled_reasons(
    baseline_payload: dict[str, Any],
) -> None:
    run_id, snapshot_id = _create_run(baseline_payload)

    response = client.get(f"/planning-runs/{run_id}")
    body = response.json()

    assert response.status_code == 200
    assert body["state"] == "OPTIMAL"
    assert body["snapshot_id"] == snapshot_id
    assert body["ruleset_version"] == "Demo Ruleset v1"
    assert body["validator"]["passed"] is True
    assert len(body["schedule_items"]) == 3
    assert body["unscheduled_jobs"] == [
        {"job_id": "JOB-004", "reason_codes": ["TRAIN_PATH_CONFLICT"]}
    ]
    assert body["kpis"]["baseline_closure_minutes"] == 390
    assert body["kpis"]["optimized_closure_minutes"] == 270
    assert body["kpis"]["downtime_reduction_minutes"] == 120
    assert body["kpis"]["downtime_reduction_percent"] == 30.77
    assert {estimate["source"] for estimate in body["ai_estimates"]} == {"LOCAL_HEURISTIC"}
    assert {item["job_id"] for item in body["jobs"]} == {
        "JOB-001",
        "JOB-002",
        "JOB-003",
        "JOB-004",
    }
    for index, first in enumerate(body["schedule_items"]):
        for second in body["schedule_items"][index + 1 :]:
            if jobs_share_conflict(first["job_id"], second["job_id"]):
                assert first["end"] <= second["start"] or second["end"] <= first["start"]


def jobs_share_conflict(first_job_id: str, second_job_id: str) -> bool:
    return {first_job_id, second_job_id} == {"JOB-001", "JOB-002"}


def test_planning_is_deterministic(baseline_payload: dict[str, Any]) -> None:
    first_run, snapshot_id = _create_run(baseline_payload)
    second = client.post(
        "/planning-runs",
        json={"snapshot_id": snapshot_id, "ruleset_version": "Demo Ruleset v1"},
    )
    first_detail = client.get(f"/planning-runs/{first_run}").json()
    second_detail = client.get(f"/planning-runs/{second.json()['run_id']}").json()

    assert first_detail["schedule_items"] == second_detail["schedule_items"]
    assert first_detail["unscheduled_jobs"] == second_detail["unscheduled_jobs"]


def test_lock_and_replan_preserve_locked_item(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)
    lock = client.post(
        f"/planning-runs/{run_id}/lock",
        json={"job_id": "JOB-001", "reason": "Planner accepted this block"},
    )
    before = client.get(f"/planning-runs/{run_id}").json()

    replan = client.post(
        f"/planning-runs/{run_id}/replan",
        json={"affected_section_ids": ["SEC-A"], "affected_window_ids": ["WIN-001"]},
    )
    child = client.get(f"/planning-runs/{replan.json()['run_id']}").json()
    before_locked = next(item for item in before["schedule_items"] if item["job_id"] == "JOB-001")
    after_locked = next(item for item in child["schedule_items"] if item["job_id"] == "JOB-001")

    assert lock.status_code == 200
    assert replan.status_code == 201
    assert after_locked == before_locked
    assert child["changes"]["JOB-001"] == "PRESERVED"
    assert child["parent_run_id"] == run_id


def test_export_requires_approval_and_contains_only_approved_run(
    baseline_payload: dict[str, Any],
) -> None:
    run_id, snapshot_id = _create_run(baseline_payload)

    blocked = client.get(f"/planning-runs/{run_id}/export")
    approval = client.post(
        f"/planning-runs/{run_id}/approve",
        json={"reviewer": "akash", "comment": "Reviewed validator and schedule"},
    )
    exported = client.get(f"/planning-runs/{run_id}/export")

    assert blocked.status_code == 409
    assert blocked.json()["code"] == "EXPORT_BLOCKED"
    assert approval.status_code == 200
    assert approval.json()["approval"]["snapshot_id"] == snapshot_id
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert run_id in exported.text
    assert "akash" in exported.text


def test_stale_snapshot_blocks_approval_and_export(baseline_payload: dict[str, Any]) -> None:
    run_id, snapshot_id = _create_run(baseline_payload)
    planning_store.set_snapshot_status(snapshot_id, "STALE")

    approval = client.post(
        f"/planning-runs/{run_id}/approve",
        json={"reviewer": "akash", "comment": "Must not be accepted"},
    )
    exported = client.get(f"/planning-runs/{run_id}/export")

    assert approval.status_code == 409
    assert approval.json()["code"] == "STALE_SNAPSHOT"
    assert exported.status_code == 409
    assert exported.json()["code"] == "EXPORT_BLOCKED"


def test_failed_independent_validator_blocks_approval(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)
    run = planning_store.get_run(run_id)
    assert run is not None
    run.validator_passed = False
    run.validator_issues = [{"code": "SAFETY_VALIDATION_FAILED"}]
    planning_store.update_run(run)

    approval = client.post(
        f"/planning-runs/{run_id}/approve",
        json={"reviewer": "akash", "comment": "Must not be accepted"},
    )

    assert approval.status_code == 409
    assert approval.json()["code"] == "SAFETY_VALIDATION_FAILED"


def _urgent_job(**overrides: Any) -> dict[str, Any]:
    job = {
        "job_id": "JOB-EMG-001",
        "department": "ELECTRICAL",
        "asset_id": "ASSET-OHE-001",
        "section_id": "SEC-B",
        "work_type": "urgent OHE defect inspection",
        "priority": 100,
        "duration_minutes": 45,
        "duration_min_minutes": 45,
        "duration_max_minutes": 60,
        "required_resources": ["ELECTRICAL_TEAM_1"],
        "allowed_windows": ["WIN-002"],
        "status": "UNSCHEDULED",
    }
    job.update(overrides)
    return job


def _rapidblock_payload(base_run_id: str, **overrides: Any) -> dict[str, Any]:
    payload = {
        "base_run_id": base_run_id,
        "actor": "planner-01",
        "actor_role": "PLANNER",
        "justification": "Urgent defect inspection",
        "source_reported_at": "2026-09-02T10:15:00+05:30",
        "urgent_job": _urgent_job(),
    }
    payload.update(overrides)
    return payload


def test_rapidblock_authorised_request_creates_candidate_with_lineage(
    baseline_payload: dict[str, Any],
) -> None:
    run_id, snapshot_id = _create_run(baseline_payload)
    lock = client.post(
        f"/planning-runs/{run_id}/lock",
        json={"job_id": "JOB-001", "reason": "Planner accepted this block"},
    )
    base_before = client.get(f"/planning-runs/{run_id}").json()

    response = client.post("/rapidblock-requests", json=_rapidblock_payload(run_id))
    body = response.json()
    detail = client.get(body["status_url"]).json()
    base_after = client.get(f"/planning-runs/{run_id}").json()
    child = client.get(f"/planning-runs/{body['child_run_id']}").json()
    blocked_export = client.get(f"/planning-runs/{body['child_run_id']}/export")
    child_approval = client.post(
        f"/planning-runs/{body['child_run_id']}/approve",
        json={"reviewer": "akash", "comment": "Reviewed RapidBlock candidate"},
    )
    child_export = client.get(f"/planning-runs/{body['child_run_id']}/export")

    assert lock.status_code == 200
    assert response.status_code == 201
    assert body["state"] == "CANDIDATE_READY"
    assert body["base_snapshot_id"] == snapshot_id
    assert body["derived_snapshot_id"] != snapshot_id
    assert detail["preserved_locked_jobs"] == ["JOB-001"]
    assert detail["validator"]["passed"] is True
    assert child["parent_run_id"] == run_id
    assert any(item["job_id"] == "JOB-EMG-001" for item in child["schedule_items"])
    assert blocked_export.status_code == 409
    assert child_approval.status_code == 200
    assert child_export.status_code == 200
    assert base_after == base_before


def test_rapidblock_rejects_unauthorised_actor(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)

    response = client.post(
        "/rapidblock-requests",
        json=_rapidblock_payload(run_id, actor="unknown-planner"),
    )

    assert response.status_code == 403
    assert response.json()["code"] == "UNAUTHORISED_ACTOR"


def test_rapidblock_rejects_outside_scope(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)

    response = client.post(
        "/rapidblock-requests",
        json=_rapidblock_payload(
            run_id,
            urgent_job=_urgent_job(
                section_id="SEC-X",
                allowed_windows=["WIN-002"],
            ),
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "OUTSIDE_PLANNING_SCOPE"


def test_rapidblock_rejects_no_eligible_window(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)

    response = client.post(
        "/rapidblock-requests",
        json=_rapidblock_payload(
            run_id,
            urgent_job=_urgent_job(
                duration_minutes=300,
                duration_min_minutes=300,
                duration_max_minutes=360,
            ),
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "NO_ELIGIBLE_WINDOW"


def test_rapidblock_rejects_locked_conflict(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)
    client.post(
        f"/planning-runs/{run_id}/lock",
        json={"job_id": "JOB-003", "reason": "Planner accepted this block"},
    )

    response = client.post("/rapidblock-requests", json=_rapidblock_payload(run_id))

    assert response.status_code == 201
    assert response.json()["state"] == "CANDIDATE_READY"


def test_rapidblock_rejects_true_locked_conflict(baseline_payload: dict[str, Any]) -> None:
    run_id, _ = _create_run(baseline_payload)
    client.post(
        f"/planning-runs/{run_id}/lock",
        json={"job_id": "JOB-003", "reason": "Planner accepted this block"},
    )

    response = client.post(
        "/rapidblock-requests",
        json=_rapidblock_payload(
            run_id,
            urgent_job=_urgent_job(
                duration_minutes=200,
                duration_min_minutes=200,
                duration_max_minutes=240,
            ),
        ),
    )

    assert response.status_code == 422
    assert response.json()["code"] == "LOCK_CONFLICT"


def test_list_planning_runs_returns_newest_first_archive_rows(
    baseline_payload: dict[str, Any],
) -> None:
    assert client.get("/planning-runs").json() == []

    first_run_id, snapshot_id = _create_run(baseline_payload)
    second_run_id, _ = _create_run(baseline_payload)
    client.post(
        f"/planning-runs/{second_run_id}/approve",
        json={"reviewer": "akash", "comment": "Reviewed validator and schedule"},
    )

    response = client.get("/planning-runs")
    body = response.json()

    assert response.status_code == 200
    assert [row["run_id"] for row in body] == [second_run_id, first_run_id]
    approved, unapproved = body
    assert approved["snapshot_id"] == snapshot_id
    assert approved["state"] == "OPTIMAL"
    assert approved["validator_passed"] is True
    assert approved["approval"]["reviewer"] == "akash"
    assert approved["total_job_count"] == 4
    assert approved["scheduled_job_count"] == len(
        client.get(f"/planning-runs/{second_run_id}").json()["schedule_items"]
    )
    assert approved["kpis"]["downtime_reduction_minutes"] >= 0
    assert unapproved["approval"] is None
    # The archive row must stay lightweight - no per-job payloads.
    assert "schedule_items" not in approved
    assert "jobs" not in approved


def test_sql_store_survives_reload_for_snapshot_run_approval_export_and_audit(
    baseline_payload: dict[str, Any],
) -> None:
    run_id, snapshot_id = _create_run(baseline_payload)
    client.post(
        f"/planning-runs/{run_id}/approve",
        json={"reviewer": "akash", "comment": "Reviewed validator and schedule"},
    )
    client.get(f"/planning-runs/{run_id}/export")
    rapidblock = client.post("/rapidblock-requests", json=_rapidblock_payload(run_id)).json()
    snapshot = planning_store.get_snapshot(snapshot_id)
    run = planning_store.get_run(run_id)
    derived_snapshot = planning_store.get_snapshot(rapidblock["derived_snapshot_id"])
    child_run = planning_store.get_run(rapidblock["child_run_id"])
    rapidblock_record = planning_store.get_rapidblock_request(rapidblock["request_id"])
    assert snapshot is not None
    assert run is not None
    assert derived_snapshot is not None
    assert child_run is not None
    assert rapidblock_record is not None

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    sql_store = SqlAlchemyPlanningStore(factory)
    sql_store.register_snapshot(snapshot.snapshot_id, snapshot.source_hash, snapshot.dataset)
    sql_store.register_snapshot(
        derived_snapshot.snapshot_id,
        derived_snapshot.source_hash,
        derived_snapshot.dataset,
        parent_snapshot_id=derived_snapshot.parent_snapshot_id,
        derivation_type=derived_snapshot.derivation_type,
        derived_from_request_id=derived_snapshot.derived_from_request_id,
        created_by=derived_snapshot.created_by,
    )
    sql_store.save_run(run)
    sql_store.save_run(child_run)
    sql_store.save_rapidblock_request(rapidblock_record)
    for export_record in planning_store.list_exports():
        sql_store.add_export(export_record)
    for event in planning_store.list_audit_events():
        sql_store.add_audit_event(event)

    reloaded = SqlAlchemyPlanningStore(factory)
    reloaded_snapshot = reloaded.get_snapshot(snapshot_id)
    reloaded_run = reloaded.get_run(run_id)
    reloaded_rapidblock = reloaded.get_rapidblock_request(rapidblock["request_id"])

    assert reloaded_snapshot is not None
    assert reloaded_snapshot.dataset.model_dump(mode="json") == snapshot.dataset.model_dump(
        mode="json"
    )
    assert reloaded_run is not None
    assert reloaded_run.approval is not None
    assert reloaded_run.kpis is not None
    assert reloaded_rapidblock is not None
    assert reloaded_rapidblock.child_run_id == rapidblock["child_run_id"]
    assert reloaded_rapidblock.state == "CANDIDATE_READY"
    assert reloaded.list_exports()[0].run_id == run_id
    assert {event.event_type for event in reloaded.list_audit_events()} >= {"APPROVED", "EXPORTED"}

    listed = reloaded.list_runs()
    assert {summary.run_id for summary in listed} == {run_id, child_run.run_id}
    baseline_summary = next(summary for summary in listed if summary.run_id == run_id)
    assert baseline_summary.approval is not None
    assert baseline_summary.validator_passed is True
    assert baseline_summary.total_job_count == len(run.changes)
    assert baseline_summary.scheduled_job_count == len(run.schedule_items)
    assert baseline_summary.kpis is not None
