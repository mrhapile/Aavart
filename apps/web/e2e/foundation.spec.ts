import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const baselinePath = path.resolve(process.cwd(), "../../fixtures/baseline_valid/dataset.json");
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? `http://127.0.0.1:${process.env.API_PORT ?? "8000"}`;

function uniqueFixturePath(): string {
  const payload = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  payload.jobs = [{ ...payload.jobs[0], job_id: "JOB-UPLOAD-999", priority: 99 }];
  payload.conflict_groups = [];
  const filePath = path.join(os.tmpdir(), "railniyojan-unique-upload.json");
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

function movableFixturePath(): string {
  const payload = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  payload.jobs = payload.jobs.map((job: { job_id: string; allowed_windows: string[] }) =>
    job.job_id === "JOB-003" ? { ...job, allowed_windows: ["WIN-002", "WIN-003"] } : job,
  );
  payload.train_paths = [];
  const filePath = path.join(os.tmpdir(), "railniyojan-movable-upload.json");
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

function invalidFixturePath(): string {
  const payload = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  payload.jobs = [{ ...payload.jobs[0], asset_id: "ASSET-DOES-NOT-EXIST" }];
  payload.conflict_groups = [];
  const filePath = path.join(os.tmpdir(), "railniyojan-invalid-upload.json");
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

async function startPlan(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start New Plan/ }).click();
  // Step 1 opens on the C1 demonstration corridor. These tests assert against
  // the 4-job baseline fixture, so pick that corridor explicitly.
  await page.getByRole("radio", { name: /Baseline Test Corridor/ }).click();
}

async function validateAndCreate(page: import("@playwright/test").Page): Promise<string> {
  await page.getByRole("button", { name: "Check Data →" }).click();
  await expect(page.getByText("Backend hash")).toBeVisible();
  const created = page.waitForResponse((response) =>
    response.url().includes("/planning-runs") &&
    response.request().method() === "POST" &&
    response.status() === 201,
  );
  await page.getByRole("button", { name: /3\. Create Plan/ }).click();
  const runId = ((await (await created).json()) as { run_id: string }).run_id;
  await expect(page.getByText("Plan Quality")).toBeVisible({ timeout: 15_000 });
  return runId;
}

async function expectNoAuthorityCopy(page: import("@playwright/test").Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/dispatch|authorize|official clearance|no further review/i);
}

test("renders the mounted RailNiyojan planning desk", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "RailNiyojan" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start New Plan/ })).toBeVisible();
});

test("uploads a real fixture and carries its unique job into the run", async ({ page, request }) => {
  await startPlan(page);
  await page.locator('input[type="file"]').first().setInputFiles(uniqueFixturePath());
  const runId = await validateAndCreate(page);

  await expect(page.getByText("JOB-UPLOAD-999")).toBeVisible();
  const detail = await request.get(`${apiUrl}/planning-runs/${runId}`);
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).jobs.map((job: { job_id: string }) => job.job_id)).toContain("JOB-UPLOAD-999");
});

test("skipping a department changes the validated job count", async ({ page }) => {
  await startPlan(page);
  await page.locator(".dept-source-card", { hasText: "Civil Engineering Works" }).getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Check Data →" }).click();

  await expect(page.getByText("Backend hash")).toBeVisible();
  await expect(page.locator(".val-stat-box").filter({ hasText: "Total Maintenance Jobs" })).toContainText("3");
  await expect(page.getByText("CIVIL: 0 jobs")).toBeVisible();
});

test("invalid uploaded data stays blocked until backend validation passes", async ({ page }) => {
  await startPlan(page);
  await page.locator('input[type="file"]').first().setInputFiles(invalidFixturePath());
  await page.getByRole("button", { name: "Check Data →" }).click();

  await expect(page.getByRole("heading", { name: /Rejected by validation/ })).toBeVisible();
  await expect(page.getByText("Backend validation must pass before the solver can run")).toBeVisible();
  await expect(page.getByRole("button", { name: /3\. Create Plan/ })).toBeDisabled();
});

test("monthly mode is shown as a 30-day filtered run instead of a dead toggle", async ({ page, request }) => {
  await startPlan(page);
  await page.getByRole("button", { name: "Monthly (30-day filter)" }).click();
  const runId = await validateAndCreate(page);

  await expect(page.getByText("30-Day Timeline Overview")).toBeVisible();
  const detail = await request.get(`${apiUrl}/planning-runs/${runId}`);
  expect(detail.ok()).toBeTruthy();
  expect((await detail.json()).planning_horizon).toBe("MONTHLY");
});

test("move and exclusion stay pending until backend re-optimization returns a child run", async ({ page, request }) => {
  await startPlan(page);
  const movable = movableFixturePath();
  const inputs = page.locator('input[type="file"]');
  for (let index = 0; index < 4; index += 1) {
    await inputs.nth(index).setInputFiles(movable);
  }
  const parentRunId = await validateAndCreate(page);

  await page.getByRole("button", { name: "Select JOB-003 (SCHEDULED)" }).click();
  await page.getByRole("button", { name: /Change Window/ }).click();
  await page.locator(".rn-window-id-input").fill("WIN-003");
  await page.getByRole("button", { name: "Move Job" }).click();
  await expect(page.getByText("1 move/exclusion intent queued.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve Plan", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Select JOB-004 (SCHEDULED)" }).click();
  await page.getByRole("button", { name: /Exclude from Plan/ }).click();
  await expect(page.getByText("2 move/exclusion intents queued.")).toBeVisible();

  const replanned = page.waitForResponse((response) =>
    response.url().includes(`/planning-runs/${parentRunId}/replan`) &&
    response.request().method() === "POST" &&
    response.status() === 201,
  );
  await page.getByRole("button", { name: /Re-Optimize Plan/ }).last().click();
  const createdChild = (await (await replanned).json()) as { run_id: string };
  const childDetail = await request.get(`${apiUrl}/planning-runs/${createdChild.run_id}`);
  expect(childDetail.ok()).toBeTruthy();
  const childRun = (await childDetail.json()) as {
    parent_run_id: string | null;
    intent_id: string | null;
    jobs: Array<{ job_id: string }>;
    schedule_items: Array<{ job_id: string; window_id: string }>;
  };
  await expect(page.getByText("Re-optimization complete", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(childRun.parent_run_id).toBe(parentRunId);
  expect(childRun.intent_id).toBeTruthy();
  expect(childRun.jobs.map((job) => job.job_id)).not.toContain("JOB-004");
  expect(childRun.schedule_items.find((item) => item.job_id === "JOB-003")?.window_id).toBe("WIN-003");
});

test("export is blocked before approval and archive reopen loads the real backend run", async ({ page }) => {
  await startPlan(page);
  const runId = await validateAndCreate(page);

  await page.getByRole("button", { name: "Approve Plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review & Approve Plan" })).toBeVisible();

  await page.getByRole("button", { name: "Export Plan (CSV)" }).click();
  await expect(page.getByText("Export Failed")).toBeVisible();

  await page.getByRole("button", { name: "Approve Plan", exact: true }).last().click();
  await expect(page.getByText("Plan Approved!")).toBeVisible({ timeout: 15_000 });

  await page.goto("/");
  await page.getByRole("button", { name: /View Previous Plans/ }).click();
  await expect(page.getByText(runId)).toBeVisible();
  // Open this test's own run, not whichever is newest. The API keeps one store
  // for the whole e2e session, so by the time this runs the archive holds runs
  // created by other specs and `.first()` opens one of those.
  await page
    .locator(".plan-archive-row")
    .filter({ hasText: runId })
    .getByRole("button", { name: "Open Review Desk →" })
    .click();
  await expect(page.getByText(`Archived run ${runId}`)).toBeVisible({ timeout: 15_000 });
});

test("backend outage during validation surfaces an error instead of fake progress", async ({ page }) => {
  await startPlan(page);
  // Match on path, not on the full origin: a reused dev server (a compose stack
  // already on this port) bakes in a different NEXT_PUBLIC_API_URL host, and an
  // origin-pinned pattern silently fails to intercept - the request succeeds and
  // this test fails claiming the outage was not surfaced.
  await page.route("**/datasets/validate", async (route) => {
    await route.abort();
  });

  await page.getByRole("button", { name: "Check Data →" }).click();

  await expect(page.getByText("Validation Failed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Select Maintenance Planning Data" })).toBeVisible();
});

test("active UI avoids authority and dispatch language", async ({ page }) => {
  await startPlan(page);
  await validateAndCreate(page);
  await expectNoAuthorityCopy(page);

  await page.getByTitle(/Go to Home/).click();
  await page.getByRole("button", { name: /Rapid-Block Review/ }).click();
  await page.getByRole("button", { name: /Submit Incident & Re-Optimize Plan/ }).click();
  await expect(page.getByText("Candidate ready")).toBeVisible({ timeout: 15_000 });
  await expectNoAuthorityCopy(page);
});
