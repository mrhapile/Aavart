"use client";

import { useEffect, useMemo, useState } from "react";
import { listPlanningRunsAdapter } from "@/lib/adapters/planning-adapter";
import { errorMessage, formatStamp, getRunStateTone } from "@/lib/utils";
import type { PlanArchiveEntry, RunState } from "@/types";

interface PreviousPlansListProps {
  onSelectPlan: (runId: string) => void;
  onBackToHome: () => void;
}

type SortKey = "date" | "tasksCount" | "runId";

export function PreviousPlansList({ onSelectPlan, onBackToHome }: PreviousPlansListProps) {
  const [entries, setEntries] = useState<PlanArchiveEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"ALL" | RunState>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);

  // Bumped by the Refresh button to re-run the fetch effect below.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listPlanningRunsAdapter()
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        // A failed fetch must never silently degrade into stale/sample rows.
        if (cancelled) return;
        setEntries([]);
        setLoadError(errorMessage(err) || "Could not load past planning runs.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleRefresh = () => {
    setIsLoading(true);
    setReloadToken((token) => token + 1);
  };

  // Only offer filters for states that actually exist in the archive.
  const availableStates = useMemo(() => {
    const seen = new Set<RunState>(entries.map((e) => e.state));
    return Array.from(seen).sort();
  }, [entries]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = entries.filter((p) => {
      if (stateFilter !== "ALL" && p.state !== stateFilter) return false;
      if (!q) return true;
      return (
        p.runId.toLowerCase().includes(q) ||
        p.snapshotId.toLowerCase().includes(q) ||
        (p.approvedBy ?? "").toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.plannedAt.localeCompare(b.plannedAt);
      else if (sortKey === "tasksCount") cmp = a.totalJobCount - b.totalJobCount;
      else cmp = a.runId.localeCompare(b.runId);
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [entries, query, stateFilter, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortAsc ? " ▲" : " ▼") : "");

  return (
    <div className="previous-plans-layout">
      <div className="planning-step-header">
        <div>
          <span className="step-kicker">ARCHIVE &amp; AUDIT TRAIL</span>
          <h2>Past Corridor Planning Runs</h2>
          <p className="step-desc">
            Every planning run persisted by the backend, newest first — with full solver lineage,
            validator outcome and approval record.
          </p>
        </div>

        <button type="button" className="btn-back-home-top" onClick={onBackToHome}>
          ← Back to Home
        </button>
      </div>

      {/* Filter / search toolbar */}
      <div className="plans-toolbar">
        <div className="plans-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <label htmlFor="plans-search-input" className="sr-only-label">Search past plans</label>
          <input
            id="plans-search-input"
            className="plans-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search run ID, snapshot, or reviewer…"
          />
          {query && (
            <button type="button" className="plans-clear-btn" onClick={() => setQuery("")} aria-label="Clear search">
              ✕
            </button>
          )}
        </div>

        <div className="plans-state-filter" role="group" aria-label="Filter by solver state">
          {(["ALL", ...availableStates] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`btn-filter-pill ${stateFilter === s ? "active" : ""}`}
              onClick={() => setStateFilter(s)}
              aria-pressed={stateFilter === s}
            >
              {s}
            </button>
          ))}
        </div>

        <span className="plans-result-count">
          {rows.length} of {entries.length} run{entries.length === 1 ? "" : "s"}
        </span>

        <button
          type="button"
          className="btn-back-home-top"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div className="previous-plans-card">
        {isLoading ? (
          <div className="rn-empty-state">
            <strong>Loading archive…</strong>
            <p>Fetching persisted planning runs from the backend.</p>
          </div>
        ) : loadError ? (
          <div className="rn-empty-state">
            <strong>Could not load the archive</strong>
            <p>{loadError}</p>
            <button type="button" className="btn-back-home-top" onClick={handleRefresh}>
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="rn-empty-state">
            <strong>No planning runs archived yet</strong>
            <p>
              Every plan you generate is persisted automatically. Create and approve a plan and it
              will appear here with its full audit trail.
            </p>
            <button type="button" className="btn-back-home-top" onClick={onBackToHome}>
              Go to Home
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rn-empty-state">
            <strong>No matching runs</strong>
            <p>
              Nothing matches {query ? `“${query}”` : "this filter"}
              {stateFilter !== "ALL" ? ` in state ${stateFilter}` : ""}. Try clearing the filters.
            </p>
            <button
              type="button"
              className="btn-back-home-top"
              onClick={() => {
                setQuery("");
                setStateFilter("ALL");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <table className="previous-plans-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => toggleSort("runId")}>
                    Plan / Run ID{sortIndicator("runId")}
                  </button>
                </th>
                <th>Snapshot Reference</th>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => toggleSort("date")}>
                    Planning Date{sortIndicator("date")}
                  </button>
                </th>
                <th>Solver State</th>
                <th>Authorized Reviewer</th>
                <th>
                  <button type="button" className="th-sort-btn" onClick={() => toggleSort("tasksCount")}>
                    Task Count{sortIndicator("tasksCount")}
                  </button>
                </th>
                <th>Downtime Gain</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((plan) => (
                <tr key={plan.runId} className="plan-archive-row">
                  <td><strong className="mono-run-id">{plan.runId}</strong></td>
                  <td><span className="mono-snap-id">{plan.snapshotId}</span></td>
                  <td>{formatStamp(plan.plannedAt)}</td>
                  <td>
                    <span className={`state-badge state-badge--${getRunStateTone(plan.state)}`}>
                      {plan.state}
                    </span>
                  </td>
                  <td>
                    {plan.approvedBy ?? <span className="neutral-cell">Not approved</span>}
                  </td>
                  <td>
                    <strong>{plan.scheduledJobCount}</strong>
                    <span className="neutral-cell"> / {plan.totalJobCount} scheduled</span>
                  </td>
                  <td className={plan.downtimeReductionPercent === null ? "neutral-cell" : "gain-cell"}>
                    {plan.downtimeReductionPercent === null ? (
                      "—"
                    ) : (
                      <strong>-{plan.downtimeReductionPercent.toFixed(1)}%</strong>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-open-plan-archive"
                      onClick={() => onSelectPlan(plan.runId)}
                      title={`Open ${plan.runId} in read-only review mode`}
                    >
                      Open Review Desk →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
