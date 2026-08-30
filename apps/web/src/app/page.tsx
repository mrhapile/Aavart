"use client";

import { useCallback, useRef, useState } from "react";
import {
  CorridorPresetId,
  DepartmentDataSource,
  OptimizationStatus,
  PlanRunView,
  ToastMessage,
  ValidationState,
} from "@/types";
import { getDepartmentSources, initialDepartmentSources } from "@/lib/mock-data";
import { getPreset } from "@/lib/corridor-presets";
import { buildDatasetPayload } from "@/lib/dataset-builder";
import {
  approveRunAdapter,
  createPlanningRunAdapter,
  exportRunAdapter,
  fetchPlanningRunAdapter,
  lockScheduleItemAdapter,
  replanRunAdapter,
  validateDatasetAdapter,
} from "@/lib/adapters/planning-adapter";
import { errorMessage } from "@/lib/utils";
import { useViewHistory } from "@/lib/use-view-history";
import { AppHeader } from "@/components/layout/AppHeader";
import { ToastContainer } from "@/components/layout/Toast";
import { HomeScreen } from "@/components/home/HomeScreen";
import { SelectDataStep } from "@/components/planning/SelectDataStep";
import { CheckDataStep } from "@/components/planning/CheckDataStep";
import { CreatePlanStep } from "@/components/planning/CreatePlanStep";
import { ReviewPlanScreen } from "@/components/review/ReviewPlanScreen";
import { ApprovePlanStep } from "@/components/planning/ApprovePlanStep";
import { PlanApprovedScreen } from "@/components/approved/PlanApprovedScreen";
import { PreviousPlansList } from "@/components/previous-plans/PreviousPlansList";
import { RapidBlockView } from "@/components/rapid-block/RapidBlockView";

/** Corridor that Step 1 opens on. */
const DEFAULT_CORRIDOR_ID: CorridorPresetId = "corridor-c1";

const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  snapshotCandidateId: null,
  issues: [],
  counts: { jobs: 0, windows: 0, assets: 0, sections: 0, resources: 0 },
};

export default function RailNiyojanApp() {
  // Navigation & View State - backed by real browser history entries so the
  // Back button moves between screens instead of leaving the app.
  const { currentView, navigate: setCurrentView, goBack, canGoBack } = useViewHistory("home");

  // Ingestion & Validation State.
  // Seeded from the corridor that Step 1 opens pre-selected (C1 / Narmada), so
  // the per-department task counts and the "Total Maintenance Load" figure match
  // the dataset that will actually be posted to /datasets/validate. Seeding from
  // the baseline fixture instead showed "4 Jobs" for a 90-job corridor.
  const [sources, setSources] = useState<DepartmentDataSource[]>(() => {
    const initial = getPreset(DEFAULT_CORRIDOR_ID);
    return initial.dataset
      ? getDepartmentSources(initial.dataset, initial.label)
      : initialDepartmentSources;
  });
  const [validation, setValidation] = useState<ValidationState>(EMPTY_VALIDATION_STATE);

  // Corridor selection — Step 1 selector.
  // Initialise to C1 (Narmada) so the user can click straight through.
  const [selectedCorridorId, setSelectedCorridorId] = useState<CorridorPresetId>(DEFAULT_CORRIDOR_ID);
  // Base dataset for the "custom" preset — only set when the user uploads a file.
  const [customBaseDataset, setCustomBaseDataset] = useState<Record<string, unknown> | null>(null);

  // Active Planning Run State - null until a real plan actually exists.
  const [plan, setPlan] = useState<PlanRunView | null>(null);
  const [hasPlanCreated, setHasPlanCreated] = useState(false);
  // Whether the currently-open plan was opened from the archive (Previous
  // Plans) rather than created in this session - it is a real backend run,
  // but it is shown read-only so a historical record is never mutated.
  const [isHistoricalPlan, setIsHistoricalPlan] = useState(false);

  // Constraint Dirty Tracking - real section/window ids touched this session,
  // fed into the real replan call instead of hardcoded literals.
  const [isDirty, setIsDirty] = useState(false);
  const [lockedCount, setLockedCount] = useState(0);
  const [dirtySectionIds, setDirtySectionIds] = useState<Set<string>>(new Set());
  const [dirtyWindowIds, setDirtyWindowIds] = useState<Set<string>>(new Set());
  const [optimizationStatus, setOptimizationStatus] = useState<OptimizationStatus>("UP_TO_DATE");

  // Global Async State & Notifications
  const [isBusy, setIsBusy] = useState(false);
  // Export has its own flag so a slow download can't be double-fired and
  // doesn't block unrelated actions behind the global busy state.
  const [isExporting, setIsExporting] = useState(false);
  // Set when the user cancels mid-solve so a late-arriving solver result is
  // discarded instead of activating a plan they backed out of.
  const solveAbortedRef = useRef(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Helper for Toasts
  const showToast = useCallback(
    (type: ToastMessage["type"], title: string, message?: string) => {
      const newToast: ToastMessage = {
        id: `toast-${Date.now()}-${Math.random()}`,
        type,
        title,
        message,
      };
      setToasts((prev) => [...prev, newToast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      }, 5000);
    },
    [],
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // --- Step 1: Select Data Handlers ---

  /**
   * When the user picks a corridor preset, re-initialise the department source
   * cards with task counts derived from that corridor's dataset.
   */
  const handleSelectCorridor = (id: CorridorPresetId) => {
    setSelectedCorridorId(id);
    const preset = getPreset(id);
    if (preset.dataset) {
      setSources(getDepartmentSources(preset.dataset, preset.label));
    }
    // For "custom", keep whatever sources are already loaded.
  };

  const handleToggleSource = (id: string) => {
    setSources((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: s.status === "loaded" ? "skipped" : "loaded",
            }
          : s,
      ),
    );
  };

  const handleReplaceFileWithContent = (
    id: string,
    fileName: string,
    content: Record<string, unknown> | null,
    sourceType: "CSV" | "JSON",
  ) => {
    setSources((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              fileName,
              status: "loaded",
              updatedAt: "Just now",
              sourceType,
              // Store parsed JSON; null means CSV (handled separately at submit time)
              customDataset: content,
            }
          : s,
      ),
    );
    showToast("info", "File Loaded", `${fileName} ready for ${id.toUpperCase()}`);
  };

  const handleUploadCustomBase = (
    content: Record<string, unknown> | null,
    fileName: string,
  ) => {
    if (!content) {
      showToast("error", "Invalid File", "Could not parse the uploaded JSON. Please check the file format.");
      return;
    }
    setCustomBaseDataset(content);
    // Reinitialise department cards from the uploaded file
    setSources(getDepartmentSources(content, fileName));
    showToast("success", "Custom Dataset Loaded", `${fileName} will be used as the base planning dataset.`);
  };

  const handleProceedToValidation = async () => {
    setIsBusy(true);
    try {
      // Determine the base dataset: preset or user-uploaded custom file.
      const preset = getPreset(selectedCorridorId);
      const baseDataset = selectedCorridorId === "custom"
        ? customBaseDataset
        : preset.dataset;

      if (!baseDataset) {
        showToast("error", "No Dataset", "Upload a base dataset file for the custom corridor before proceeding.");
        return;
      }

      // Apply per-department skips and file overrides on top of the base.
      const payload = buildDatasetPayload(baseDataset, sources);
      const res = await validateDatasetAdapter(payload, "JSON");
      setValidation(res);
      setCurrentView("wizard-step-2");
    } catch (err) {
      // Real failure - stay on step 1, never advance with fabricated data.
      showToast("error", "Validation Failed", errorMessage(err) || "Could not validate dataset with the backend.");
    } finally {
      setIsBusy(false);
    }
  };

  // --- Step 2: Check Data Handlers ---
  const handleResolveIssue = (issueId: string) => {
    setValidation((prev) => {
      const updated = prev.issues.map((i) => (i.id === issueId ? { ...i, resolved: true } : i));
      const allResolved = updated.every((i) => i.resolved);
      return {
        ...prev,
        valid: allResolved,
        issues: updated,
      };
    });
    showToast("success", "Issue Marked Resolved", "This will be re-checked by the solver at plan creation.");
  };

  const handleAutoFixAll = () => {
    // Mark the real issues already returned by the backend as resolved
    // locally - there is no backend "auto-fix" endpoint, so this must not
    // claim a fabricated "backend verified perfect" state.
    setValidation((prev) => ({
      ...prev,
      valid: true,
      issues: prev.issues.map((i) => ({ ...i, resolved: true })),
    }));
    showToast("success", "Issues Marked Resolved", "Resolved locally - the solver will re-validate at plan creation.");
  };

  // --- Step 3: Create Plan Handlers ---
  const handleTriggerSolve = useCallback(async (): Promise<boolean> => {
    if (!validation.snapshotCandidateId) {
      showToast("error", "No Validated Snapshot", "Validate a dataset before creating a plan.");
      return false;
    }
    solveAbortedRef.current = false;
    try {
      const newPlan = await createPlanningRunAdapter(validation.snapshotCandidateId);
      // The user cancelled while the solver was still running - discard the
      // result rather than silently activating a plan they backed out of.
      if (solveAbortedRef.current) return false;
      setPlan(newPlan);
      setIsHistoricalPlan(false);
      setHasPlanCreated(true);
      setIsDirty(false);
      setLockedCount(0);
      setDirtySectionIds(new Set());
      setDirtyWindowIds(new Set());
      setOptimizationStatus("UP_TO_DATE");
      return true;
    } catch (err) {
      if (solveAbortedRef.current) return false;
      showToast("error", "Solver Error", errorMessage(err) || "Optimization failed.");
      return false;
    }
  }, [validation.snapshotCandidateId, showToast]);

  const handleCancelSolve = useCallback(() => {
    solveAbortedRef.current = true;
    setCurrentView("wizard-step-2");
    showToast("info", "Plan Creation Cancelled", "The in-flight solver result will be discarded.");
  }, [setCurrentView, showToast]);

  const handlePlanReady = useCallback(() => {
    // Replace, not push: the solver progress screen must not be a Back target
    // (going "back" into it would re-run the solve).
    setCurrentView("wizard-step-4", { replace: true });
    showToast("success", "Plan Generated Successfully", "Review corridor schedule and lock priority jobs.");
  }, [setCurrentView, showToast]);

  // --- Step 4: Review Plan Actions ---
  const trackDirtyJob = (jobId: string, extraWindowId?: string) => {
    const job = plan?.jobs.find((j) => j.job_id === jobId);
    if (!job) return;
    setDirtySectionIds((prev) => new Set(prev).add(job.section_id));
    setDirtyWindowIds((prev) => {
      const next = new Set(prev);
      if (job.scheduled_window_id) next.add(job.scheduled_window_id);
      if (extraWindowId) next.add(extraWindowId);
      return next;
    });
  };

  const handleLockJob = async (jobId: string) => {
    if (!plan) return;
    setIsBusy(true);
    try {
      trackDirtyJob(jobId);
      const updatedPlan = await lockScheduleItemAdapter(plan.run_id, jobId);
      setPlan(updatedPlan);
      setIsDirty(true);
      setLockedCount((prev) => prev + 1);
      setOptimizationStatus("UNSAVED_CONSTRAINTS");
      showToast("success", `Job ${jobId} Locked`, "Schedule pinned. Re-optimize when ready to recalculate other work.");
    } catch (err) {
      showToast("error", "Lock Action Failed", errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleChangeWindow = (jobId: string, newWindowId: string) => {
    trackDirtyJob(jobId, newWindowId);
    setPlan((prev) => {
      if (!prev) return prev;
      const updatedJobs = prev.jobs.map((j) =>
        j.job_id === jobId
          ? {
              ...j,
              scheduled_window_id: newWindowId,
              preferred_window: newWindowId,
              locked: true,
              status: "LOCKED" as const,
            }
          : j,
      );
      return { ...prev, jobs: updatedJobs };
    });
    setIsDirty(true);
    setLockedCount((prev) => prev + 1);
    setOptimizationStatus("UNSAVED_CONSTRAINTS");
    showToast("info", `Window Adjusted for ${jobId}`, "Constraint modified locally. Re-optimize to have the solver confirm it.");
  };

  const handleExcludeJob = (jobId: string) => {
    trackDirtyJob(jobId);
    setPlan((prev) => {
      if (!prev) return prev;
      const updatedJobs = prev.jobs.map((j) =>
        j.job_id === jobId ? { ...j, status: "UNSCHEDULED" as const } : j,
      );
      const updatedSchedule = prev.schedule_items.filter((s) => s.job_id !== jobId);
      return { ...prev, jobs: updatedJobs, schedule_items: updatedSchedule };
    });
    setIsDirty(true);
    setOptimizationStatus("UNSAVED_CONSTRAINTS");
    showToast("warning", `Job ${jobId} Excluded`, "Task removed from weekly schedule.");
  };

  const handleReoptimize = async () => {
    if (!plan) return;
    if (dirtySectionIds.size === 0 || dirtyWindowIds.size === 0) {
      showToast("info", "Nothing to Re-Optimize", "Lock, move, or exclude a job first so the solver knows what changed.");
      return;
    }
    setIsBusy(true);
    setOptimizationStatus("REOPTIMIZING");
    try {
      const replanned = await replanRunAdapter(
        plan.run_id,
        Array.from(dirtySectionIds),
        Array.from(dirtyWindowIds),
      );
      setPlan(replanned);
      setIsDirty(false);
      setDirtySectionIds(new Set());
      setDirtyWindowIds(new Set());
      setOptimizationStatus("UPDATED");
      showToast(
        "success",
        "Re-Optimization Complete",
        `New run ${replanned.run_id} calculated. Locked items preserved, downstream jobs shifted.`,
      );
    } catch (err) {
      setOptimizationStatus("FAILED");
      showToast("error", "Re-Optimization Infeasible", errorMessage(err) || "Constraint conflict.");
    } finally {
      setIsBusy(false);
    }
  };

  // --- Step 5: Approve Plan Handlers ---
  const handleApprovePlan = async (reviewer: string, comment: string) => {
    if (!plan) return;
    setIsBusy(true);
    try {
      const approved = await approveRunAdapter(plan.run_id, reviewer, comment);
      setPlan(approved);
      // Replace: once approved, Back should not return to the sign-off form
      // for an already-approved plan.
      setCurrentView("plan-approved", { replace: true });
      showToast("success", "Plan Digitally Approved", "Official dispatch clearance granted.");
    } catch (err) {
      showToast("error", "Approval Failed", errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  // --- Post-Approval Export ---
  const handleExportPlan = async () => {
    if (!plan || isExporting) return;
    setIsExporting(true);
    try {
      await exportRunAdapter(plan.run_id);
      showToast("success", "Export Started", `Downloading schedule for ${plan.run_id}`);
    } catch (err) {
      showToast("error", "Export Failed", errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  // Starting a new plan version must clear the previous pass entirely -
  // otherwise the stepper still offers steps 4/5 and would jump into the
  // stale plan while the user is re-selecting data for a new one.
  const handleNewPlanVersion = () => {
    setPlan(null);
    setHasPlanCreated(false);
    setIsHistoricalPlan(false);
    setValidation(EMPTY_VALIDATION_STATE);
    setIsDirty(false);
    setLockedCount(0);
    setDirtySectionIds(new Set());
    setDirtyWindowIds(new Set());
    setOptimizationStatus("UP_TO_DATE");
    // Re-seed department cards from the currently-selected corridor
    const preset = getPreset(selectedCorridorId);
    if (preset.dataset) setSources(getDepartmentSources(preset.dataset, preset.label));
    setCurrentView("wizard-step-1");
  };

  // --- Past Plans Handler ---
  // Loads the full historical run from GET /planning-runs/{run_id} and opens
  // it on the review desk read-only. A failed fetch leaves the current plan
  // untouched and surfaces the real error rather than showing sample data.
  const handleOpenPreviousPlan = async (runId: string) => {
    setIsBusy(true);
    try {
      const historical = await fetchPlanningRunAdapter(runId);
      setPlan(historical);
      setIsHistoricalPlan(true);
      setIsDirty(false);
      setLockedCount(historical.jobs.filter((job) => job.locked).length);
      setDirtySectionIds(new Set());
      setDirtyWindowIds(new Set());
      setOptimizationStatus("UP_TO_DATE");
      setCurrentView("wizard-step-4");
      showToast("info", "Opened Archived Plan", `Viewing ${runId} in read-only mode.`);
    } catch (err) {
      showToast("error", "Could Not Open Plan", errorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  // --- Rapid Block Handler ---
  // Adopts the approved emergency child run as the new active plan, so the
  // rest of the app (header, review screen, etc.) reflects the real
  // post-dispatch state going forward.
  const handleDispatchApproved = (newPlan: PlanRunView) => {
    setPlan(newPlan);
    setIsHistoricalPlan(false);
    setIsDirty(false);
    setDirtySectionIds(new Set());
    setDirtyWindowIds(new Set());
    setOptimizationStatus("UP_TO_DATE");
    showToast("success", "Emergency Dispatch Successful", `${newPlan.run_id} is now the active plan.`);
  };


  return (
    <main className="railniyojan-app-root">
      {/* 1. Global Application Header with Integrated Stepper */}
      <AppHeader
        currentView={currentView}
        onNavigate={setCurrentView}
        planId={plan?.run_id}
        isPlanCreated={hasPlanCreated}
        isApproved={Boolean(plan?.approval)}
        canGoBack={canGoBack}
        onGoBack={goBack}
      />

      {/* 2. Main Dynamic Content Switcher */}
      <div className="view-content-wrapper">
        {currentView === "home" && (
          <HomeScreen
            onNavigate={setCurrentView}
            activePlanId={plan?.run_id ?? ""}
            hasActivePlan={hasPlanCreated}
          />
        )}

        {currentView === "wizard-step-1" && (
          <SelectDataStep
            sources={sources}
            onToggleSourceStatus={handleToggleSource}
            onReplaceFileWithContent={handleReplaceFileWithContent}
            onContinue={handleProceedToValidation}
            onCancel={() => setCurrentView("home")}
            isBusy={isBusy}
            selectedCorridorId={selectedCorridorId}
            onSelectCorridor={handleSelectCorridor}
            customBaseDataset={customBaseDataset}
            onUploadCustomBase={handleUploadCustomBase}
          />
        )}

        {currentView === "wizard-step-2" && (
          <CheckDataStep
            validation={validation}
            onResolveIssue={handleResolveIssue}
            onAutoFixAll={handleAutoFixAll}
            onContinue={() => setCurrentView("wizard-step-3")}
            onBack={() => setCurrentView("wizard-step-1")}
            isBusy={isBusy}
          />
        )}

        {currentView === "wizard-step-3" && (
          <CreatePlanStep
            snapshotId={validation.snapshotCandidateId ?? ""}
            onPlanReady={handlePlanReady}
            onCancel={handleCancelSolve}
            onTriggerSolve={handleTriggerSolve}
          />
        )}

        {currentView === "wizard-step-4" &&
          (plan ? (
            <ReviewPlanScreen
              plan={plan}
              isDirty={isDirty}
              lockedCount={lockedCount}
              optimizationStatus={optimizationStatus}
              isBusy={isBusy}
              isHistoricalPlan={isHistoricalPlan}
              onLockJob={handleLockJob}
              onChangeWindow={handleChangeWindow}
              onExcludeJob={handleExcludeJob}
              onReoptimize={handleReoptimize}
              onApproveStep={() => setCurrentView("wizard-step-5")}
              onExport={handleExportPlan}
              isExporting={isExporting}
              onNewVersion={handleNewPlanVersion}
            />
          ) : (
            <NoPlanRedirect onNavigateHome={() => setCurrentView("home")} />
          ))}

        {currentView === "wizard-step-5" &&
          (plan ? (
            <ApprovePlanStep
              plan={plan}
              onApprove={handleApprovePlan}
              onBack={() => setCurrentView("wizard-step-4")}
              onExport={handleExportPlan}
              isBusy={isBusy}
              isExporting={isExporting}
            />
          ) : (
            <NoPlanRedirect onNavigateHome={() => setCurrentView("home")} />
          ))}

        {currentView === "plan-approved" &&
          (plan ? (
            <PlanApprovedScreen
              plan={plan}
              onExport={handleExportPlan}
              isExporting={isExporting}
              onNewVersion={handleNewPlanVersion}
            />
          ) : (
            <NoPlanRedirect onNavigateHome={() => setCurrentView("home")} />
          ))}

        {currentView === "previous-plans" && (
          <PreviousPlansList
            onSelectPlan={(runId) => void handleOpenPreviousPlan(runId)}
            onBackToHome={() => setCurrentView("home")}
          />
        )}

        {currentView === "rapid-block" &&
          (plan ? (
            <RapidBlockView
              plan={plan}
              onExitToHome={() => setCurrentView("home")}
              onShowToast={showToast}
              onDispatchApproved={handleDispatchApproved}
            />
          ) : (
            <NoPlanRedirect onNavigateHome={() => setCurrentView("home")} message="Create a plan first - Rapid Block needs an active run to inject an emergency job into." />
          ))}
      </div>

      {/* 4. Global Toast Notifications Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* 5. Static Technical Footer */}
      <footer className="app-system-footer">
        <div className="footer-left">
          <span>RailNiyojan v0.1.0 • SIH26027</span>
          <span className="footer-separator">•</span>
          <span>Google OR-Tools CP-SAT</span>
          <span className="footer-separator">•</span>
          <span>Western Railway Division</span>
        </div>
        <div className="footer-right">
          <span>Synthetic data • Demonstration ruleset • Human approval required</span>
        </div>
      </footer>
    </main>
  );
}

function NoPlanRedirect({ onNavigateHome, message }: { onNavigateHome: () => void; message?: string }) {
  return (
    <div className="rn-no-plan-redirect">
      <p>{message ?? "There is no active plan yet."}</p>
      <button type="button" className="btn-back-home-top" onClick={onNavigateHome}>
        ← Back to Home
      </button>
    </div>
  );
}
