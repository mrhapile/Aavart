/**
 * Corridor presets registry.
 *
 * Each preset bundles display metadata + the canonical dataset.json that will
 * be posted to /datasets/validate when the user proceeds from Step 1.
 *
 * NOTE: These are CONTROLLED-SCENARIO datasets (synthetic, demo ruleset).
 * They must never be presented as Railway-authorized operational data.
 */
import c1Dataset from "../../../../fixtures/generated/corridor_1/dataset.json";
import c1Stations from "../../../../fixtures/generated/corridor_1/stations.json";
import c2Dataset from "../../../../fixtures/generated/corridor_2/dataset.json";
import c2Stations from "../../../../fixtures/generated/corridor_2/stations.json";
import baselineDataset from "../../../../fixtures/baseline_valid/dataset.json";
import type { CorridorPreset, CorridorPresetId, StationInfo } from "@/types";

export const CORRIDOR_PRESETS: CorridorPreset[] = [
  {
    id: "corridor-c1",
    label: "Narmada Demonstration Corridor",
    description:
      "UP/DOWN Double Line · Absolute Block · 11 sections, 90 maintenance jobs",
    chainage: "Km 0 – 92.4",
    lineType: "Double Line",
    sectionCount: 11,
    jobCount: 90,
    dataset: c1Dataset as Record<string, unknown>,
    stations: c1Stations as StationInfo[],
  },
  {
    id: "corridor-c2",
    label: "Sahyadri Demonstration Corridor",
    description:
      "Single Line · Tokenless Block · 11 sections, 90 maintenance jobs",
    chainage: "Km 100 – 192.4",
    lineType: "Single Line",
    sectionCount: 11,
    jobCount: 90,
    dataset: c2Dataset as Record<string, unknown>,
    stations: c2Stations as StationInfo[],
  },
  {
    id: "baseline",
    label: "Baseline Test Corridor",
    description:
      "Minimal 2-section fixture (nodes A / B / C) — for API smoke-testing",
    chainage: "N/A",
    lineType: "N/A",
    sectionCount: 2,
    jobCount: 4,
    dataset: baselineDataset as Record<string, unknown>,
  },
  {
    id: "custom",
    label: "Custom Dataset",
    description:
      "Upload your own JSON or CSV planning dataset",
    chainage: "—",
    lineType: "—",
    sectionCount: 0,
    jobCount: 0,
    dataset: null,
  },
];

/** Returns the preset for the given id (falls back to C1 if not found). */
export function getPreset(id: CorridorPresetId): CorridorPreset {
  return CORRIDOR_PRESETS.find((p) => p.id === id) ?? CORRIDOR_PRESETS[0];
}
