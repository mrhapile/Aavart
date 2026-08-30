import baselineDatasetFixture from "../../../../fixtures/baseline_valid/dataset.json";
import { DepartmentDataSource, DepartmentType } from "@/types";

// ---------------------------------------------------------------------------
// Department source cards — Step 1 of the planning wizard
// ---------------------------------------------------------------------------

type RawJob = { department?: string; [key: string]: unknown };

function countByDept(
  jobs: RawJob[],
  dept: DepartmentType,
): number {
  return jobs.filter((j) => j.department === dept).length;
}

/**
 * Builds the initial DepartmentDataSource array for a given dataset.
 * Task counts are derived from the dataset's actual job records so the
 * numbers shown in the UI match what gets posted to /datasets/validate.
 */
export function getDepartmentSources(
  dataset: Record<string, unknown>,
  label = "Corridor dataset",
): DepartmentDataSource[] {
  const jobs = (dataset.jobs as RawJob[] | undefined) ?? [];
  return [
    {
      id: "tms",
      name: "Track Management System (TMS)",
      department: "TRACK",
      fileName: label,
      taskCount: countByDept(jobs, "TRACK"),
      status: "loaded",
      updatedAt: label,
      sourceType: "JSON",
      customDataset: null,
    },
    {
      id: "smms",
      name: "Signal Maintenance System (SMMS)",
      department: "SIGNAL",
      fileName: label,
      taskCount: countByDept(jobs, "SIGNAL"),
      status: "loaded",
      updatedAt: label,
      sourceType: "JSON",
      customDataset: null,
    },
    {
      id: "tdms",
      name: "Traction & OHE System (TDMS)",
      department: "ELECTRICAL",
      fileName: label,
      taskCount: countByDept(jobs, "ELECTRICAL"),
      status: "loaded",
      updatedAt: label,
      sourceType: "JSON",
      customDataset: null,
    },
    {
      id: "civil",
      name: "Civil Engineering Works",
      department: "CIVIL",
      fileName: label,
      taskCount: countByDept(jobs, "CIVIL"),
      status: "loaded",
      updatedAt: label,
      sourceType: "JSON",
      customDataset: null,
    },
  ];
}

/** Convenience: pre-built sources using the baseline test fixture. */
export const initialDepartmentSources: DepartmentDataSource[] =
  getDepartmentSources(
    baselineDatasetFixture as Record<string, unknown>,
    "baseline_valid/dataset.json",
  );
