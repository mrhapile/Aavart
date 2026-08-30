"use client";

import { RapidBlockImpactView, SectionInfo } from "@/types";
import { CorridorMap } from "@/components/shared/CorridorMap";

interface RapidBlockMapProps {
  impact: RapidBlockImpactView | null;
  selectedSectionId: string;
  sections: SectionInfo[];
}

export function RapidBlockMap({ impact, selectedSectionId, sections }: RapidBlockMapProps) {
  const activeSection = impact?.incidentLocation.sectionId || selectedSectionId;
  const incidentLabel = impact?.incidentLocation.incidentType;
  const hasImpact = Boolean(impact);

  return (
    <div className="rapid-block-map-card">
      <div className="map-card-topline">
        <div className="map-title-group">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <h3>2. Live Map &amp; Blast Radius</h3>
        </div>

        {hasImpact ? (
          <span className="impact-detected-badge">
            <span className="pulse-dot-red" aria-hidden="true" />
            Emergency Impact Detected
          </span>
        ) : (
          <span className="impact-idle-badge">Awaiting incident</span>
        )}
      </div>

      <div className="rapid-map-canvas">
        <CorridorMap
          sections={sections}
          activeSectionId={hasImpact ? null : activeSection}
          incidentSectionId={hasImpact ? activeSection : null}
          incidentLabel={incidentLabel}
          size="tall"
        />
      </div>

      <div className="rapid-map-meta">
        <div className="meta-sec-badge">
          <span>Affected section</span>
          <strong>{activeSection || "None selected"}</strong>
        </div>
        {!hasImpact && (
          <span className="blast-radius-label">
            Submit the incident form to compute the blast radius.
          </span>
        )}
      </div>
    </div>
  );
}
