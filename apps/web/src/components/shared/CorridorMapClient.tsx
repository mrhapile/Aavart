"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngTuple, PointTuple } from "leaflet";
import { SectionInfo } from "@/types";
import { getStationGeo } from "@/lib/station-geo";

export type CorridorMapSize = "compact" | "tall";

interface CorridorMapClientProps {
  sections: SectionInfo[];
  activeSectionId?: string | null;
  incidentSectionId?: string | null;
  incidentLabel?: string | null;
  size?: CorridorMapSize;
}

/** Track colour by the backend-reported section status. */
const STATUS_COLOR: Record<string, string> = {
  CLEAR: "#16A34A",
  CAUTION: "#F59E0B",
  RESTRICTED: "#EF4444",
};
/** Status is not reported by the current backend payload - draw it as neutral. */
const UNKNOWN_COLOR = "#0047BA";
const INCIDENT_COLOR = "#DC2626";
const ACTIVE_COLOR = "#0047BA";

/** Centre of the demo corridors - only used before bounds are known. */
const FALLBACK_CENTER: LatLngTuple = [22.9, 76.2];

const FIT_PADDING: PointTuple = [40, 40];
/** Whole-corridor framing. */
const CORRIDOR_MAX_ZOOM = 12;
/** Framing for a single selected/incident section. */
const FOCUS_MAX_ZOOM = 13;

interface Segment {
  section: SectionInfo;
  coords: [LatLngTuple, LatLngTuple];
  fromLabel: string;
  toLabel: string;
  isActive: boolean;
  isIncident: boolean;
  color: string;
}

/**
 * Owns everything that depends on the map's measured size.
 *
 * Leaflet measures its container once, at construction. Inside a flex/grid card
 * (and inside a modal that mounts hidden) that happens before the final size
 * settles - which both produces the classic "grey tiles in the corner" map and
 * makes the initial fitBounds compute a zoom for the wrong viewport. So resize
 * and framing are handled together: every re-measure is followed by a re-fit.
 */
function MapController({
  corridorBounds,
  focusBounds,
  focusKey,
}: {
  corridorBounds: LatLngBoundsExpression | null;
  focusBounds: LatLngBoundsExpression | null;
  focusKey: string | null;
}) {
  const map = useMap();

  // Read inside callbacks without making them a dependency of the resize effect.
  const targetRef = useRef<{ bounds: LatLngBoundsExpression | null; maxZoom: number }>({
    bounds: corridorBounds,
    maxZoom: CORRIDOR_MAX_ZOOM,
  });

  // The section highlighted on first paint comes from the default-selected job,
  // not from a user action - opening zoomed into it would hide the rest of the
  // corridor. So the viewport only follows a focus *change*, and "changed" is
  // decided by comparing the section id rather than by a has-mounted flag: dev
  // StrictMode invokes effects twice, and a flag would fall through on the
  // second pass and zoom into the default section on load.
  const lastFocusRef = useRef<string | null>(focusKey);

  useEffect(() => {
    const container = map.getContainer();
    const revalidate = () => {
      map.invalidateSize({ animate: false });
      const { bounds, maxZoom } = targetRef.current;
      if (bounds) map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom, animate: false });
    };

    const raf = requestAnimationFrame(revalidate);
    const observer = new ResizeObserver(revalidate);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [map]);

  useEffect(() => {
    if (!corridorBounds) return;
    targetRef.current = { bounds: corridorBounds, maxZoom: CORRIDOR_MAX_ZOOM };
    map.fitBounds(corridorBounds, { padding: FIT_PADDING, maxZoom: CORRIDOR_MAX_ZOOM, animate: false });
  }, [map, corridorBounds]);

  useEffect(() => {
    if (focusKey === lastFocusRef.current) return;
    lastFocusRef.current = focusKey;
    if (!focusBounds) return;
    targetRef.current = { bounds: focusBounds, maxZoom: FOCUS_MAX_ZOOM };
    map.fitBounds(focusBounds, { padding: FIT_PADDING, maxZoom: FOCUS_MAX_ZOOM, animate: true });
  }, [map, focusBounds, focusKey]);

  return null;
}

export default function CorridorMapClient({
  sections,
  activeSectionId,
  incidentSectionId,
  incidentLabel,
  size = "compact",
}: CorridorMapClientProps) {
  // NOTE: every hook must run before any early return - `sections` legitimately
  // goes from empty to populated (the plan arrives, an incident is submitted),
  // and bailing out above a hook would change the hook count between renders.

  // Geometry depends only on the sections. Kept in its own memo so that merely
  // selecting a different section does not hand MapController a fresh
  // `corridorBounds` identity, which would re-fit the whole corridor a frame
  // before flying to the selected one.
  const { geometry, corridorBounds, nodes } = useMemo(() => {
    const built: Array<{
      section: SectionInfo;
      coords: [LatLngTuple, LatLngTuple];
      fromLabel: string;
      toLabel: string;
    }> = [];
    const points: LatLngTuple[] = [];
    const uniqueNodes = new Map<string, { coords: LatLngTuple; label: string }>();

    for (const section of sections) {
      const from = getStationGeo(section.from_node);
      const to = getStationGeo(section.to_node);
      if (!from || !to) continue;

      const a: LatLngTuple = [from.lat, from.lng];
      const b: LatLngTuple = [to.lat, to.lng];

      points.push(a, b);
      uniqueNodes.set(from.code, { coords: a, label: from.name });
      uniqueNodes.set(to.code, { coords: b, label: to.name });

      built.push({ section, coords: [a, b], fromLabel: from.name, toLabel: to.name });
    }

    return {
      geometry: built,
      nodes: Array.from(uniqueNodes.entries()),
      corridorBounds: points.length > 0 ? (points as LatLngBoundsExpression) : null,
    };
  }, [sections]);

  // Selection state layered on top of the geometry.
  const { segments, focusBounds } = useMemo(() => {
    const focusPoints: LatLngTuple[] = [];

    const built: Segment[] = geometry.map((g) => {
      const isActive = activeSectionId === g.section.section_id;
      const isIncident = incidentSectionId === g.section.section_id;
      if (isActive || isIncident) focusPoints.push(g.coords[0], g.coords[1]);

      return {
        ...g,
        isActive,
        isIncident,
        color: isIncident
          ? INCIDENT_COLOR
          : isActive
            ? ACTIVE_COLOR
            : g.section.status
              ? (STATUS_COLOR[g.section.status] ?? UNKNOWN_COLOR)
              : UNKNOWN_COLOR,
      };
    });

    return {
      segments: built,
      focusBounds: focusPoints.length > 0 ? (focusPoints as LatLngBoundsExpression) : null,
    };
  }, [geometry, activeSectionId, incidentSectionId]);

  if (sections.length === 0) {
    return (
      <div className={`rn-corridor-map-wrap is-${size} rn-corridor-map-empty`}>
        <strong>No corridor sections yet</strong>
        <p>The route appears once the solver returns sections for this run.</p>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className={`rn-corridor-map-wrap is-${size} rn-corridor-map-empty`}>
        <strong>No geographic coordinates for this corridor</strong>
        <p>
          {sections.length} section{sections.length === 1 ? "" : "s"} in this run have no station
          coordinates in the loaded fixtures, so the route cannot be plotted.
        </p>
      </div>
    );
  }

  return (
    <div className={`rn-corridor-map-wrap is-${size}`}>
      <MapContainer
        center={FALLBACK_CENTER}
        zoom={9}
        scrollWheelZoom={false}
        zoomControl
        className="rn-leaflet-map"
      >
        {/* Standard OSM tiles: no API key and no origin allowlist, so they work
            on localhost and on any demo host. They are muted down to a Positron
            -like basemap by a CSS filter on the tile pane (see globals.css), so
            the corridor overlay stays the most prominent thing on the map. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        <MapController
          corridorBounds={corridorBounds}
          focusBounds={focusBounds}
          focusKey={incidentSectionId ?? activeSectionId ?? null}
        />

        {/* Casing under every segment: a white outline so the route reads as one
            railway line over the basemap, widened and tinted into a selection
            halo on the active / incident section. */}
        {segments.map((seg) => (
          <Polyline
            key={`casing-${seg.section.section_id}`}
            positions={seg.coords}
            interactive={false}
            pathOptions={{
              color: seg.isIncident ? INCIDENT_COLOR : seg.isActive ? ACTIVE_COLOR : "#FFFFFF",
              weight: seg.isActive || seg.isIncident ? 14 : 8,
              opacity: seg.isActive || seg.isIncident ? 0.28 : 0.9,
              lineCap: "round",
            }}
          />
        ))}

        {segments.map((seg) => (
          <Polyline
            key={seg.section.section_id}
            positions={seg.coords}
            pathOptions={{
              color: seg.color,
              weight: seg.isActive || seg.isIncident ? 6 : 4,
              opacity: seg.isActive || seg.isIncident ? 1 : 0.85,
              lineCap: "round",
            }}
          >
            <Tooltip sticky className="rn-map-tip">
              <span className="rn-map-tip-title">{seg.section.name || seg.section.section_id}</span>
              <span className="rn-map-tip-route">
                {seg.fromLabel} → {seg.toLabel}
              </span>
              {seg.isIncident ? (
                <span className="rn-map-tip-incident">{incidentLabel ?? "Emergency block"}</span>
              ) : (
                <span className="rn-map-tip-meta">
                  {seg.section.total_works} work item{seg.section.total_works === 1 ? "" : "s"}
                  {seg.section.status ? ` · ${seg.section.status}` : ""}
                </span>
              )}
            </Tooltip>
          </Polyline>
        ))}

        {nodes.map(([code, node]) => (
          <CircleMarker
            key={`node-${code}`}
            center={node.coords}
            radius={5}
            pathOptions={{
              fillColor: "#FFFFFF",
              color: "#0F2850",
              weight: 2.5,
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} className="rn-map-tip">
              <span className="rn-map-tip-title">{node.label}</span>
              <span className="rn-map-tip-meta">Node {code}</span>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="rn-map-legend">
        <span className="rn-map-legend-item">
          <i className="rn-map-swatch route" /> Corridor route
        </span>
        <span className="rn-map-legend-item">
          <i className="rn-map-swatch node" /> Station / node
        </span>
        {incidentSectionId && (
          <span className="rn-map-legend-item">
            <i className="rn-map-swatch incident" /> Incident section
          </span>
        )}
      </div>
    </div>
  );
}
