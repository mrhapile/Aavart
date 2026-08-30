"use client";

import { useEffect, useRef } from "react";
import { JobDetailView, SectionInfo } from "@/types";
import { CorridorMap } from "@/components/shared/CorridorMap";

interface ExpandedMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  sections: SectionInfo[];
  jobs: JobDetailView[];
  activeSectionId: string | null;
  onSelectSection: (sectionId: string | null) => void;
}

/**
 * Full-width corridor map with per-section detail — the expanded counterpart
 * to the condensed map on the Review screen.
 */
export function ExpandedMapModal({
  isOpen,
  onClose,
  sections,
  jobs,
  activeSectionId,
  onSelectSection,
}: ExpandedMapModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const jobsForSection = (sectionId: string) => jobs.filter((j) => j.section_id === sectionId);

  return (
    <div className="modal-backdrop expanded-timeline-backdrop" role="dialog" aria-modal="true" aria-labelledby="expanded-map-title">
      <div className="expanded-timeline-dialog" ref={dialogRef} tabIndex={-1}>
        <div className="expanded-top-bar">
          <div>
            <span className="mono-kicker">Corridor Detail View</span>
            <h2 id="expanded-map-title">Corridor Map — {sections.length} section{sections.length === 1 ? "" : "s"}</h2>
          </div>
          <button type="button" className="btn-close-expanded" onClick={onClose}>
            ✕ Collapse View
          </button>
        </div>

        <div className="expanded-scroll-area">
          <div className="expanded-map-wrap">
            <CorridorMap sections={sections} activeSectionId={activeSectionId} size="tall" />
          </div>

          {sections.length === 0 ? (
            <div className="rn-empty-state">
              <strong>No section data</strong>
              <p>This run has no sections to display.</p>
            </div>
          ) : (
            <div className="expanded-map-sections">
              {sections.map((sec) => {
                const secJobs = jobsForSection(sec.section_id);
                const isActive = activeSectionId === sec.section_id;
                return (
                  <button
                    type="button"
                    key={sec.section_id}
                    className={`expanded-map-section-card ${isActive ? "selected" : ""}`}
                    onClick={() => onSelectSection(isActive ? null : sec.section_id)}
                    aria-pressed={isActive}
                  >
                    <div className="expanded-map-sec-head">
                      <strong>{sec.section_id}</strong>
                      <span className={`rn-status-badge ${sec.status?.toLowerCase() ?? "unknown"}`}>
                        {sec.status ? sec.status.charAt(0) + sec.status.slice(1).toLowerCase() : "Unknown"}
                      </span>
                    </div>
                    <div className="expanded-map-sec-meta">
                      <span>
                        {sec.from_node && sec.to_node ? `${sec.from_node} – ${sec.to_node}` : "Route unknown"}
                      </span>
                      <span>
                        {sec.km_start != null && sec.km_end != null
                          ? `Km ${sec.km_start} – ${sec.km_end}`
                          : "Km unknown"}
                      </span>
                    </div>
                    <div className="expanded-map-sec-jobs">
                      {secJobs.length === 0 && <span className="sec-txt">No work planned</span>}
                      {secJobs.map((j) => (
                        <span key={j.job_id} className={`dept-badge-sm ${j.department.toLowerCase()}`} title={`${j.job_id} — ${j.work_type}`}>
                          {j.job_id}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
