/**
 * Builds the final dataset payload to POST to /datasets/validate.
 *
 * The payload is assembled from:
 *  1. A base corridor dataset (contains all sections, assets, windows, resources, train_paths, etc.)
 *  2. Per-department overrides supplied by the SelectDataStep source cards.
 *
 * Rules per department:
 *  - "skipped"      → that department's jobs are excluded entirely.
 *  - customDataset  → jobs from the uploaded file (filtered to that dept) replace the base jobs.
 *  - default        → the corridor's jobs for that department pass through unchanged.
 *
 * All other top-level keys (sections, assets, windows, resources, train_paths,
 * conflict_groups, metadata, schema_version) are taken from the base dataset without modification.
 */

import type { DepartmentDataSource, DepartmentType } from "@/types";

type RawJob = { department?: string; [key: string]: unknown };
type RawDataset = { jobs?: RawJob[]; [key: string]: unknown };

/** Maps DepartmentDataSource.id → DepartmentType string used in job records. */
const SOURCE_ID_TO_DEPT: Record<string, DepartmentType> = {
  tms: "TRACK",
  smms: "SIGNAL",
  tdms: "ELECTRICAL",
  civil: "CIVIL",
};

export function buildDatasetPayload(
  baseDataset: Record<string, unknown>,
  sources: DepartmentDataSource[],
): Record<string, unknown> {
  const baseJobs: RawJob[] = ((baseDataset as RawDataset).jobs ?? []);
  const mergedJobs: RawJob[] = [];

  for (const source of sources) {
    const dept = SOURCE_ID_TO_DEPT[source.id];
    if (!dept) continue;

    if (source.status === "skipped") {
      // Exclude this department entirely — no jobs added.
      continue;
    }

    if (source.customDataset) {
      // Use jobs from the user-uploaded file for this department.
      const uploadedJobs: RawJob[] =
        ((source.customDataset as RawDataset).jobs ?? []).filter(
          (j) => !j.department || j.department === dept,
        );
      mergedJobs.push(...uploadedJobs);
    } else {
      // Default: pass the corridor base dataset's jobs for this department through.
      mergedJobs.push(...baseJobs.filter((j) => j.department === dept));
    }
  }

  return {
    ...baseDataset,
    jobs: mergedJobs,
  };
}
