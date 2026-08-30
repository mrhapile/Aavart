"use client";

import dynamic from "next/dynamic";
import { SectionInfo } from "@/types";
import type { CorridorMapSize } from "./CorridorMapClient";

interface CorridorMapProps {
  sections: SectionInfo[];
  activeSectionId?: string | null;
  incidentSectionId?: string | null;
  incidentLabel?: string | null;
  /** "compact" for the in-card map, "tall" for the modal / emergency desk. */
  size?: CorridorMapSize;
}

const DynamicCorridorMapClient = dynamic(() => import("./CorridorMapClient"), {
  // Leaflet touches `window` at import time, so it must never run on the server.
  ssr: false,
  loading: () => (
    <div className="rn-corridor-map-wrap is-compact rn-corridor-map-loading">
      <span className="rn-map-spinner" aria-hidden="true" />
      <span>Loading corridor map…</span>
    </div>
  ),
});

/**
 * Client-only wrapper around the Leaflet corridor map. Kept as a separate,
 * dependency-free module so importing the map never pulls Leaflet into a
 * server component's graph.
 */
export function CorridorMap(props: CorridorMapProps) {
  return <DynamicCorridorMapClient {...props} />;
}
