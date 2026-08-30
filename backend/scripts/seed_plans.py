"""Seed the planning archive with real, solver-produced runs.

Drives the running API exactly as the UI does - validate the dataset, create a
planning run, then approve it - so every seeded row in "Previous Plans" is a
genuine optimizer output with real KPIs, a real validator verdict and a real
approval record. Nothing here fabricates a schedule.

Usage:
    uv run --project backend python backend/scripts/seed_plans.py
    uv run --project backend python backend/scripts/seed_plans.py --base-url http://localhost:8000

The API must already be running and, to persist across restarts, configured
with STORE_BACKEND=sql against a migrated database.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURES = REPOSITORY_ROOT / "fixtures" / "generated"
RULESET_VERSION = "Demo Ruleset v1"

# Corridors seeded by default, in the order the archive should show them
# (later entries end up newest). Labels mirror the frontend corridor presets.
CORRIDORS: list[tuple[str, Path]] = [
    ("Sahyadri Demonstration Corridor", FIXTURES / "corridor_2" / "dataset.json"),
    ("Narmada Demonstration Corridor", FIXTURES / "corridor_1" / "dataset.json"),
]

REVIEWER = "AR (Divisional Manager, WR - Vadodara)"


class SeedError(RuntimeError):
    """A seeding step failed - reported verbatim rather than worked around."""


def _post(client: httpx.Client, path: str, payload: Any) -> dict[str, Any]:
    response = client.post(path, json=payload)
    if response.status_code >= 400:
        raise SeedError(f"POST {path} -> {response.status_code} {response.text}")
    body: dict[str, Any] = response.json()
    return body


def _get(client: httpx.Client, path: str) -> dict[str, Any]:
    response = client.get(path)
    if response.status_code >= 400:
        raise SeedError(f"GET {path} -> {response.status_code} {response.text}")
    body: dict[str, Any] = response.json()
    return body


def seed_corridor(client: httpx.Client, label: str, dataset_path: Path) -> dict[str, Any]:
    """Validates, plans and approves one corridor. Returns the run detail."""
    if not dataset_path.exists():
        raise SeedError(
            f"{dataset_path} is missing - run "
            "'uv run --project backend python backend/scripts/generate_demo_datasets.py' first"
        )
    dataset = json.loads(dataset_path.read_text())

    print(f"→ {label}: validating {dataset_path.relative_to(REPOSITORY_ROOT)}")
    validation = _post(client, "/datasets/validate", dataset)
    if not validation["valid"]:
        errors = validation.get("errors", [])
        raise SeedError(f"{label}: dataset is invalid ({len(errors)} errors): {errors[:3]}")
    snapshot_id = validation["snapshot_candidate_id"]
    counts = validation["counts"]
    print(f"  snapshot {snapshot_id} ({counts['jobs']} jobs, {counts['windows']} windows)")

    print(f"  planning {label}…")
    created = _post(
        client,
        "/planning-runs",
        {"snapshot_id": snapshot_id, "ruleset_version": RULESET_VERSION},
    )
    run_id = created["run_id"]
    detail = _get(client, f"/planning-runs/{run_id}")
    scheduled = len(detail["schedule_items"])
    print(
        f"  {run_id} -> {detail['state']}, {scheduled}/{len(detail['jobs'])} jobs scheduled, "
        f"validator {'passed' if detail['validator']['passed'] else 'FAILED'}"
    )

    # Only a feasible, validator-clean run may be approved - the same guard the
    # API enforces. An unapproved run still lands in the archive.
    if detail["approval"] is not None:
        print("  already approved")
    elif detail["state"] in {"FEASIBLE", "OPTIMAL"} and detail["validator"]["passed"]:
        _post(
            client,
            f"/planning-runs/{run_id}/approve",
            {
                "reviewer": REVIEWER,
                "comment": f"Seeded archive run for the {label}.",
            },
        )
        print(f"  approved by {REVIEWER}")
        detail = _get(client, f"/planning-runs/{run_id}")
    else:
        print(
            f"  NOT approved - state {detail['state']}, "
            f"validator passed={detail['validator']['passed']}"
        )
    return detail


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default="http://localhost:8000",
        help="Base URL of the running RailNiyojan API (default: %(default)s)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=180.0,
        help="Per-request timeout in seconds - planning a 90-job corridor is slow",
    )
    args = parser.parse_args()

    with httpx.Client(base_url=args.base_url, timeout=args.timeout) as client:
        try:
            health = _get(client, "/health")
        except (httpx.HTTPError, SeedError) as err:
            print(f"Cannot reach the API at {args.base_url}: {err}", file=sys.stderr)
            return 1
        print(f"API at {args.base_url} is {health['status']}\n")

        try:
            for label, dataset_path in CORRIDORS:
                seed_corridor(client, label, dataset_path)
                print()
            archive = client.get("/planning-runs")
            archive.raise_for_status()
        except (httpx.HTTPError, SeedError) as err:
            print(f"Seeding failed: {err}", file=sys.stderr)
            return 1

    rows = archive.json()
    print(f"Archive now holds {len(rows)} run(s):")
    for row in rows:
        reviewer = row["approval"]["reviewer"] if row["approval"] else "unapproved"
        print(
            f"  {row['run_id']}  {row['state']:<9} "
            f"{row['scheduled_job_count']}/{row['total_job_count']} jobs  {reviewer}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
