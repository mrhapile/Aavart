/**
 * Node-code -> geographic coordinate lookup for the corridor map.
 *
 * Deliberately kept separate from `corridor-presets.ts`: the map is a lazily
 * loaded client chunk, and importing the presets there would drag both full
 * ~100 KB `dataset.json` fixtures into it. Only the (small) station files and
 * the section topology the map actually draws are imported here.
 *
 * NOTE: CONTROLLED-SCENARIO coordinates from the generated demo fixtures.
 * They are not surveyed Railway geodata.
 */
import c1Stations from "../../../../fixtures/generated/corridor_1/stations.json";
import c2Stations from "../../../../fixtures/generated/corridor_2/stations.json";
import type { StationInfo } from "@/types";

export interface StationGeo {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

const ALL_STATIONS = [...(c1Stations as StationInfo[]), ...(c2Stations as StationInfo[])];

const GEO_BY_CODE = new Map<string, StationGeo>(
  ALL_STATIONS.map((s) => [
    s.code,
    { code: s.code, name: s.name, lat: s.latitude, lng: s.longitude },
  ]),
);

/** Returns the coordinates for a section's from_node/to_node code, if known. */
export function getStationGeo(code: string | null | undefined): StationGeo | undefined {
  if (!code) return undefined;
  return GEO_BY_CODE.get(code);
}

/** True when at least one node of the corridor has known coordinates. */
export function hasAnyGeo(codes: Array<string | null | undefined>): boolean {
  return codes.some((c) => Boolean(c && GEO_BY_CODE.has(c)));
}
