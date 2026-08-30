"use client";

import { useEffect, useState } from "react";
import { AppView } from "@/types";
import { WorkflowStepper } from "@/components/navigation/WorkflowStepper";
import { isBackendAlive } from "@/lib/adapters/planning-adapter";

interface AppHeaderProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  planId?: string;
  isPlanCreated?: boolean;
  isApproved?: boolean;
  canGoBack?: boolean;
  onGoBack?: () => void;
}

export function AppHeader({
  currentView,
  onNavigate,
  planId,
  isPlanCreated = false,
  isApproved = false,
  canGoBack = false,
  onGoBack,
}: AppHeaderProps) {
  const isEmergency = currentView === "rapid-block";
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Tick the clock from an interval rather than setting state in the effect
    // body; the first tick is scheduled, not synchronous.
    const clockId = setInterval(() => setNow(new Date()), 30_000);
    const firstTick = window.setTimeout(() => {
      setMounted(true);
      setNow(new Date());
    }, 0);

    let cancelled = false;
    const checkHealth = () => {
      isBackendAlive().then((ok) => {
        if (!cancelled) setIsOnline(ok);
      });
    };
    checkHealth();
    const healthId = setInterval(checkHealth, 15_000);

    return () => {
      cancelled = true;
      clearInterval(clockId);
      clearInterval(healthId);
      window.clearTimeout(firstTick);
    };
  }, []);
  const isWizard =
    currentView === "wizard-step-1" ||
    currentView === "wizard-step-2" ||
    currentView === "wizard-step-3" ||
    currentView === "wizard-step-4" ||
    currentView === "wizard-step-5" ||
    currentView === "plan-approved";

  return (
    <header className="rn-header">
      {/* 1. Back affordance + Brand / Logo */}
      <div className="rn-brand-block">
        {canGoBack && currentView !== "home" && (
          <button
            type="button"
            className="rn-back-btn"
            onClick={onGoBack}
            aria-label="Go back to the previous screen"
            title="Back (or use your browser's Back button)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="rn-brand-btn"
          onClick={() => onNavigate("home")}
          title={planId ? `Go to Home (active plan ${planId})` : "Go to RailNiyojan Home"}
        >
          <div className="rn-logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F2850" strokeWidth="2">
              {/* Locomotive engine icon */}
              <rect x="4" y="3" width="16" height="14" rx="3" />
              <path d="M4 11h16" />
              <circle cx="8" cy="7" r="1.5" fill="#0F2850" />
              <circle cx="16" cy="7" r="1.5" fill="#0F2850" />
              <path d="M6 17l-2 4" />
              <path d="M18 17l2 4" />
              <path d="M4 21h16" />
            </svg>
          </div>
          <div className="rn-brand-titles">
            <span className="rn-brand-title">RailNiyojan</span>
            <span className="rn-brand-subtitle">Integrated Block Planning</span>
          </div>
        </button>
      </div>

      {/* 2. Center: Workflow Stepper (Wizard) or Quick Navigation */}
      <div className="rn-header-center">
        {isWizard ? (
          <WorkflowStepper
            currentView={currentView}
            onNavigate={onNavigate}
            isPlanCreated={isPlanCreated}
            isApproved={isApproved}
          />
        ) : isEmergency ? (
          <div className="rn-emergency-badge">
            <span className="rn-pulse-red" />
            <strong>RAPID BLOCK EMERGENCY DESK</strong>
          </div>
        ) : null}
      </div>

      {/* 3. Right: Backend Status, Date, Time, User Profile */}
      <div className="rn-header-meta">
        <div
          className={`rn-backend-status ${isOnline === null ? "unknown" : isOnline ? "online" : "offline"}`}
          title={isOnline === null ? "Checking backend..." : isOnline ? "Backend reachable" : "Backend unreachable"}
        >
          <span className="rn-status-dot" />
          <span>{isOnline === null ? "Checking..." : isOnline ? "Backend Online" : "Backend Unreachable"}</span>
        </div>

        <div className="rn-datetime-group">
          <div className="rn-date-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>{mounted && now ? now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span>
          </div>

          <div className="rn-time-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{mounted && now ? now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
          </div>
        </div>

        <div className="rn-user-pill" title="Signed in as the demo planner (no authentication in this build)">
          <div className="rn-user-avatar">AR</div>
          <div className="rn-user-text">
            <span className="rn-user-role">Divisional Manager</span>
            <span className="rn-user-div">WR - Vadodara</span>
          </div>
        </div>
      </div>
    </header>
  );
}
