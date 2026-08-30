"use client";

import { useCallback, useSyncExternalStore } from "react";
import { AppView } from "@/types";

const VIEW_HASH: Record<AppView, string> = {
  home: "",
  "wizard-step-1": "#select-data",
  "wizard-step-2": "#check-data",
  "wizard-step-3": "#create-plan",
  "wizard-step-4": "#review-plan",
  "wizard-step-5": "#approve-plan",
  "plan-approved": "#plan-approved",
  "previous-plans": "#previous-plans",
  "rapid-block": "#rapid-block",
};

const HASH_VIEW = new Map<string, AppView>(
  (Object.entries(VIEW_HASH) as Array<[AppView, string]>).map(([view, hash]) => [hash, view]),
);

interface HistoryEntry {
  view: AppView;
  depth: number;
}

function readEntry(): HistoryEntry {
  if (typeof window === "undefined") return { view: "home", depth: 0 };
  const state = window.history.state as Partial<HistoryEntry> | null;
  const view = state?.view ?? HASH_VIEW.get(window.location.hash) ?? "home";
  return { view, depth: state?.depth ?? 0 };
}

/**
 * Browser history is an external store, so it is read through
 * useSyncExternalStore rather than mirrored into state via an effect.
 * `pushState`/`replaceState` do not emit events, so navigations notify
 * subscribers explicitly.
 */
const listeners = new Set<() => void>();
let snapshot: HistoryEntry = { view: "home", depth: 0 };

function emit() {
  snapshot = readEntry();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    snapshot = readEntry();
  }
  listeners.add(listener);
  window.addEventListener("popstate", emit);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("popstate", emit);
  };
}

const getSnapshot = () => snapshot;
// Must be referentially stable - returning a fresh object on every call makes
// useSyncExternalStore re-render forever during SSR/hydration.
const SERVER_SNAPSHOT: HistoryEntry = { view: "home", depth: 0 };
const getServerSnapshot = (): HistoryEntry => SERVER_SNAPSHOT;

/**
 * Keeps the single-page view in sync with real browser history entries, so
 * Back moves between in-app screens instead of leaving the site.
 */
export function useViewHistory(initialView: AppView = "home") {
  const entry = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const navigate = useCallback((view: AppView, options?: { replace?: boolean }) => {
    const current = readEntry();
    if (current.view === view) return;
    const replace = options?.replace ?? false;
    const nextDepth = replace ? current.depth : current.depth + 1;
    const url = VIEW_HASH[view] || window.location.pathname;
    const next: HistoryEntry = { view, depth: nextDepth };
    if (replace) window.history.replaceState(next, "", url);
    else window.history.pushState(next, "", url);
    emit();
  }, []);

  const goBack = useCallback(() => {
    if (readEntry().depth > 0) window.history.back();
  }, []);

  return {
    currentView: entry.view ?? initialView,
    navigate,
    goBack,
    canGoBack: entry.depth > 0,
  };
}
