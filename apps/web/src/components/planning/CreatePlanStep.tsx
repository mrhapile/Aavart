"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/utils";

interface CreatePlanStepProps {
  snapshotId: string;
  onPlanReady: () => void;
  onCancel: () => void;
  onTriggerSolve: () => Promise<boolean>;
}

interface PipelineStep {
  id: number;
  label: string;
}

const pipelineSteps: PipelineStep[] = [
  { id: 1, label: "Analyzing train occupancy" },
  { id: 2, label: "Identifying maintenance windows" },
  { id: 3, label: "Combining compatible work" },
  { id: 4, label: "Optimizing to reduce disruption" },
  { id: 5, label: "Checking safety constraints" },
];

export function CreatePlanStep({
  onPlanReady,
  onCancel,
  onTriggerSolve,
}: CreatePlanStepProps) {
  // Starts at step 0 / low progress - these only ever advance once the real
  // onTriggerSolve() call is actually in flight (see the effect below), and
  // never reach 100%/"done" until that promise resolves.
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(8);
  const [isCompleted, setIsCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The solve is a mount-once pipeline. onTriggerSolve/onPlanReady are re-created
  // by the parent on every render, and onTriggerSolve itself sets parent state, so
  // without this guard the effect re-fires and floods the API with runs.
  //
  // Deliberately NOT cancelled from the effect cleanup: React's dev StrictMode
  // mounts -> cleans up -> remounts, and the remount is short-circuited by this
  // guard. A cleanup-scoped `cancelled` flag would therefore be latched on by the
  // first (discarded) pass and permanently swallow the real solver result, leaving
  // the screen stuck at 8%. Abort is owned by the parent instead: cancelling
  // navigates away and makes onTriggerSolve() resolve false.
  const hasSolvedRef = useRef(false);

  useEffect(() => {
    if (hasSolvedRef.current) return;
    hasSolvedRef.current = true;

    // Purely a "still working" visual heartbeat while the real solve call is in
    // flight - it never marks the plan complete on its own; only the real
    // onTriggerSolve() result below does that.
    const heartbeat = setInterval(() => {
      setCurrentStepIndex((idx) => Math.min(idx + 1, 3));
      setProgressPercent((p) => Math.min(p + 12, 88));
    }, 1200);

    onTriggerSolve()
      .then((success) => {
        if (success) {
          setCurrentStepIndex(5);
          setProgressPercent(100);
          setIsCompleted(true);
          setTimeout(onPlanReady, 400);
        } else {
          setError("Solver failed to compute a conflict-free schedule.");
        }
      })
      .catch((err) => {
        setError(errorMessage(err) || "Optimization engine unavailable.");
      })
      .finally(() => {
        clearInterval(heartbeat);
      });
  }, [onTriggerSolve, onPlanReady]);

  return (
    <div className="rn-create-plan-container">
      <div className="rn-create-plan-card">
        <div className="rn-create-plan-content">
          {/* Left Column: Pipeline Checklist */}
          <div className="rn-create-left">
            <h1 className="rn-create-title">Creating Your Plan</h1>
            <p className="rn-create-subtitle">
              Finding the best way to do maintenance with least disruption.
            </p>

            <div className="rn-pipeline-list">
              {pipelineSteps.map((step, index) => {
                const isStepDone = index < currentStepIndex || isCompleted;
                const isStepActive = index === currentStepIndex && !isCompleted;
                const isStepPending = index > currentStepIndex && !isCompleted;

                return (
                  <div
                    key={step.id}
                    className={`rn-pipeline-item ${isStepDone ? "done" : ""} ${
                      isStepActive ? "active" : ""
                    } ${isStepPending ? "pending" : ""}`}
                  >
                    <div className="rn-pipeline-icon">
                      {isStepDone ? (
                        <div className="rn-icon-circle done">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="3.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      ) : isStepActive ? (
                        <div className="rn-icon-circle active">
                          <span className="rn-target-dot" />
                        </div>
                      ) : (
                        <div className="rn-icon-circle pending" />
                      )}
                    </div>

                    <span className="rn-pipeline-label">{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Front Train Line-Art Illustration */}
          <div className="rn-create-right">
            <div className="rn-front-train-art">
              <svg viewBox="0 0 380 240" className="rn-front-train-svg" fill="none">
                {/* Background trees & clouds */}
                <path d="M 40 100 Q 60 70 80 100 Q 100 70 120 100 Z" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1" />
                <path d="M 260 100 Q 280 70 300 100 Q 320 70 340 100 Z" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1" />
                
                {/* Overhead Catenary Mast */}
                <line x1="70" y1="20" x2="70" y2="180" stroke="#94A3B8" strokeWidth="1.5" />
                <line x1="310" y1="20" x2="310" y2="180" stroke="#94A3B8" strokeWidth="1.5" />
                <line x1="60" y1="40" x2="320" y2="40" stroke="#94A3B8" strokeWidth="1.5" />
                <line x1="70" y1="60" x2="310" y2="60" stroke="#94A3B8" strokeWidth="1" />

                {/* Overhead Contact Wires */}
                <path d="M 0 50 Q 190 70 380 50" stroke="#0047BA" strokeWidth="1.5" />

                {/* Perspective Railway Tracks */}
                <line x1="190" y1="130" x2="20" y2="240" stroke="#0047BA" strokeWidth="2.5" />
                <line x1="190" y1="130" x2="360" y2="240" stroke="#0047BA" strokeWidth="2.5" />
                {/* Sleepers */}
                {[150, 170, 190, 210, 230].map((y, idx) => {
                  const leftX = 190 - (190 - 20) * ((y - 130) / 110);
                  const rightX = 190 + (360 - 190) * ((y - 130) / 110);
                  return (
                    <line key={y} x1={leftX} y1={y} x2={rightX} y2={y} stroke="#94A3B8" strokeWidth={1 + idx * 0.5} />
                  );
                })}

                {/* Front-Facing Modern Train */}
                <g transform="translate(140, 70)">
                  {/* Pantograph */}
                  <path d="M 40 10 L 50 0 L 60 10" stroke="#0047BA" strokeWidth="1.5" />
                  <line x1="42" y1="0" x2="58" y2="0" stroke="#0047BA" strokeWidth="2" />

                  {/* Body Contour */}
                  <path
                    d="M 20 120 L 80 120 L 88 45 Q 88 15 50 15 Q 12 15 12 45 Z"
                    fill="#FFFFFF"
                    stroke="#0047BA"
                    strokeWidth="2"
                  />
                  {/* Front Windshield */}
                  <path
                    d="M 22 45 Q 50 35 78 45 L 75 70 Q 50 65 25 70 Z"
                    fill="#E2E8F0"
                    stroke="#0047BA"
                    strokeWidth="1.5"
                  />
                  {/* Wiper */}
                  <line x1="50" y1="65" x2="40" y2="48" stroke="#0047BA" strokeWidth="1.5" />

                  {/* Headlights */}
                  <ellipse cx="28" cy="98" rx="5" ry="3" fill="#F59E0B" stroke="#0047BA" strokeWidth="1" />
                  <ellipse cx="72" cy="98" rx="5" ry="3" fill="#F59E0B" stroke="#0047BA" strokeWidth="1" />

                  {/* Indian Railways Logo Emblem Circle */}
                  <circle cx="50" cy="92" r="3.5" fill="#0047BA" />

                  {/* Cowcatcher / Front Buffer */}
                  <path d="M 25 120 L 35 130 L 65 130 L 75 120 Z" fill="#64748B" stroke="#0047BA" strokeWidth="1.5" />
                </g>
              </svg>
            </div>
          </div>
        </div>

        {/* Progress Bar Row */}
        <div className="rn-progress-row">
          <span className="rn-progress-label">Progress</span>
          <div className="rn-progress-track">
            <div
              className="rn-progress-bar-striped"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="rn-progress-value">{progressPercent}%</span>
        </div>

        {error && (
          <div className="rn-solver-error">
            <span>⚠️ {error}</span>
          </div>
        )}
      </div>

      {/* Bottom Action Controls */}
      <div className="rn-create-footer">
        <button type="button" className="rn-btn-cancel-plan" onClick={onCancel}>
          Cancel Plan
        </button>

        <button type="button" className="rn-btn-please-wait" disabled>
          <span>Please Wait...</span>
          <span className="rn-spinner-dots" />
        </button>
      </div>
    </div>
  );
}
