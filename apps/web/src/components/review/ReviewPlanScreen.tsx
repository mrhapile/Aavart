"use client";

import { useMemo, useState } from "react";
import { OptimizationStatus, PlanRunView } from "@/types";
import { CorridorOverview } from "@/components/review/CorridorOverview";
import { WeeklyTimelineSummary } from "@/components/review/WeeklyTimelineSummary";
import { ExpandedTimelineModal } from "@/components/review/ExpandedTimelineModal";
import { PlanImpact } from "@/components/review/PlanImpact";
import { JobInspector } from "@/components/review/JobInspector";
import { GlobalPlanActions } from "@/components/review/GlobalPlanActions";
import { formatStamp } from "@/lib/utils";

interface ReviewPlanScreenProps {
  plan: PlanRunView;
  isDirty: boolean;
  lockedCount: number;
  optimizationStatus: OptimizationStatus;
  isBusy: boolean;
  isHistoricalPlan?: boolean;
  onLockJob: (jobId: string) => Promise<void>;
  onChangeWindow: (jobId: string, newWindowId: string) => void;
  onExcludeJob: (jobId: string) => void;
  onReoptimize: () => Promise<void>;
  onApproveStep: () => void;
  onExport: () => Promise<void>;
  isExporting?: boolean;
  onNewVersion?: () => void;
}

export function ReviewPlanScreen({
  plan,
  isDirty,
  lockedCount,
  optimizationStatus,
  isHistoricalPlan = false,
  isBusy,
  onLockJob,
  onChangeWindow,
  onExcludeJob,
  onReoptimize,
  onApproveStep,
  onExport,
  isExporting = false,
  onNewVersion,
}: ReviewPlanScreenProps) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(plan.jobs[0]?.job_id ?? null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [isExpandedTimelineOpen, setIsExpandedTimelineOpen] = useState(false);

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return plan.jobs[0] ?? null;
    return plan.jobs.find((j) => j.job_id === selectedJobId) ?? plan.jobs[0] ?? null;
  }, [plan.jobs, selectedJobId]);

  const currentIndex = useMemo(() => {
    if (!selectedJob) return 0;
    const idx = plan.jobs.findIndex((j) => j.job_id === selectedJob.job_id);
    return idx >= 0 ? idx : 0;
  }, [plan.jobs, selectedJob]);

  const handlePrevJob = () => {
    if (plan.jobs.length === 0) return;
    const prevIdx = (currentIndex - 1 + plan.jobs.length) % plan.jobs.length;
    setSelectedJobId(plan.jobs[prevIdx].job_id);
  };

  const handleNextJob = () => {
    if (plan.jobs.length === 0) return;
    const nextIdx = (currentIndex + 1) % plan.jobs.length;
    setSelectedJobId(plan.jobs[nextIdx].job_id);
  };

  const isApproved = Boolean(plan.approval);
  // An archived run is a historical record: it opens read-only whether or not
  // it carries an approval, so the desk never mutates a past plan.
  const isReadOnly = isApproved || isHistoricalPlan;

  // Mirrors the "Approve Plan Guard" spec: isDirty -> validator -> state.
  let approveBlockedReason: string | undefined;
  if (isHistoricalPlan) approveBlockedReason = "This is an archived run, opened read-only.";
  else if (isDirty) approveBlockedReason = "Re-optimize the plan before approving.";
  else if (!plan.validator.passed) approveBlockedReason = "Independent safety validation failed.";
  else if (!(plan.state === "FEASIBLE" || plan.state === "OPTIMAL")) {
    approveBlockedReason = `Plan is not in an approvable state (${plan.state}).`;
  }
  const canApprove = !isReadOnly && !approveBlockedReason;

  return (
    <div className="rn-review-workspace">
      {isHistoricalPlan && (
        <div className="demo-data-banner">
          📁 Archived run {plan.run_id}, loaded from the backend and opened read-only.
        </div>
      )}
      <div className="rn-review-grid">
        {/* Left Column: Corridor Map, Timeline & Impact, Important Notice Banner */}
        <div className="rn-review-main-col">
          {/* 1. Corridor Overview */}
          <CorridorOverview
            sections={plan.sections}
            jobs={plan.jobs}
            selectedJob={selectedJob}
            selectedSectionId={selectedSectionId}
            onSelectSection={setSelectedSectionId}
            onSelectJobId={setSelectedJobId}
          />

          {/* 2. Middle Row: Weekly Timeline Overview + Plan Impact */}
          <div className="rn-review-mid-grid">
            <WeeklyTimelineSummary
              plan={plan}
              selectedJobId={selectedJobId}
              onSelectJobId={setSelectedJobId}
              onExpandTimeline={() => setIsExpandedTimelineOpen(true)}
            />

            <PlanImpact
              kpis={plan.kpis}
              jobCounts={{
                total: plan.jobs.length,
                scheduled: plan.jobs.filter((j) => j.status === "SCHEDULED" || j.status === "LOCKED").length,
                unscheduled: plan.unscheduled_jobs.length,
              }}
              validatorPassed={plan.validator.passed}
            />
          </div>

          {/* 3. Bottom banner: read-only notice once approved, otherwise the
              re-optimize prompt (hidden once approved per spec). */}
          {isApproved || isHistoricalPlan ? (
            <div className="rn-important-banner approved">
              <div className="rn-important-left">
                <div className="rn-info-circle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div className="rn-important-text">
                  <strong>{isApproved ? "Approved" : "Archived"}</strong>
                  <p>
                    {isApproved
                      ? `This plan was approved by ${plan.approval?.reviewer} on ${formatStamp(plan.approval?.approved_at)}. It is now locked for editing.`
                      : "This run was opened from the archive and was never approved. It is shown read-only."}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rn-important-banner">
              <div className="rn-important-left">
                <div className="rn-info-circle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0047BA" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </div>
                <div className="rn-important-text">
                  <strong>Important</strong>
                  <p>Locking or changing a job requires re-optimizing the plan before it can be approved.</p>
                </div>
              </div>

              <button
                type="button"
                className="rn-btn-reoptimize-banner"
                onClick={onReoptimize}
                disabled={isBusy || !isDirty}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                <span>Re-Optimize Plan</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Job Inspector & Global Plan Actions */}
        <div className="rn-review-sidebar-col">
          <JobInspector
            plan={plan}
            selectedJob={selectedJob}
            currentIndex={currentIndex}
            totalJobs={plan.jobs.length}
            onPrevJob={handlePrevJob}
            onNextJob={handleNextJob}
            isApproved={isReadOnly}
            isBusy={isBusy}
            onLockJob={onLockJob}
            onChangeWindow={onChangeWindow}
            onExcludeJob={onExcludeJob}
          />

          <GlobalPlanActions
            optimizationStatus={optimizationStatus}
            lockedJobCount={lockedCount}
            isApproved={isReadOnly}
            canApprove={canApprove}
            approveBlockedReason={approveBlockedReason}
            isBusy={isBusy}
            onReoptimize={onReoptimize}
            onApproveStep={onApproveStep}
            onExport={onExport}
            isExporting={isExporting}
            onNewVersion={onNewVersion}
          />
        </div>
      </div>

      {/* Expanded Timeline Modal */}
      <ExpandedTimelineModal
        isOpen={isExpandedTimelineOpen}
        onClose={() => setIsExpandedTimelineOpen(false)}
        plan={plan}
        selectedJobId={selectedJobId}
        onSelectJobId={setSelectedJobId}
      />
    </div>
  );
}
