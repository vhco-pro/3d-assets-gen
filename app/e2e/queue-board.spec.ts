// The queue as a place to follow work (AC-26): summary, batch groups, times and estimates, source images.
// Runs on its own stacks because it cancels and retries fixture jobs and lowers the unfinished limit.
import type { Page } from "@playwright/test";
import { expect, signIn, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

const MIN = 60_000;

/** The seed time T: the fixture's Generating job was queued 12 minutes before it. */
async function seedTime(stack: Stack): Promise<number> {
  const res = await fetch(`${stack.url}/api/jobs`, { headers: { authorization: `Bearer ${stack.token}` } });
  const { jobs } = (await res.json()) as { jobs: { prompt: string | null; queuedAt: number }[] };
  const crystal = jobs.find((j) => j.prompt === "a glowing crystal");
  if (!crystal) throw new Error("fixture job missing");
  return crystal.queuedAt + 12 * MIN;
}

const batch = (page: Page, name: string) => page.getByTestId("batch").filter({ hasText: name });

test.describe("on the seeded fixture", () => {
  let stack: Stack;
  test.beforeAll(async () => {
    stack = await startStack("queue-board", "default");
  });
  test.afterAll(async () => {
    await stack.stop();
  });

  test("summary, batch group, chips, times and estimates on a fixed clock", async ({ page }) => {
    await page.clock.setFixedTime(await seedTime(stack));
    await signIn(page, stack.url, stack.token);
    const summary = page.getByTestId("queue-summary");
    await expect(summary).toContainText("1 Generating");
    await expect(summary).toContainText("1 Queued");
    await expect(summary).toContainText("0 Waiting");
    await expect(summary).toContainText("3 Failed");
    // Running remainder 400 - 180 s plus the queued job's 400 s.
    await expect(summary).toContainText("Queue clear in about 10 min 20 s");
    const set = batch(page, "a mossy stone well");
    await expect(set).toContainText("1 of 4 done");
    const running = set.getByTestId("job").filter({ hasText: "a glowing crystal" });
    await expect(running.getByTestId("job-state")).toHaveText("Generating");
    await expect(running).toContainText("Generating for 3 min");
    await expect(running).toContainText("about 3 min 40 s left");
    await expect(running.getByRole("progressbar")).toBeVisible();
    for (const chip of ["10k", "2048", "seed 1001"]) await expect(running).toContainText(chip);
    const queued = set.getByTestId("job").filter({ hasText: "a potion bottle" });
    await expect(queued).toContainText("Added 12 min ago");
    await expect(queued).toContainText("Starts in about 3 min 40 s");
    await expect(running.getByRole("img", { name: "Source of a glowing crystal" })).toBeVisible({ timeout: 30_000 });
  });

  test("a finished batch starts collapsed and stays as the user leaves it across a refresh", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    const old = batch(page, "a wooden treasure chest");
    await expect(old.getByRole("button", { name: "Expand batch" })).toBeVisible();
    await expect(old.getByTestId("job")).toHaveCount(0);
    await old.getByRole("button", { name: "Expand batch" }).click();
    await expect(old.getByTestId("job").first()).toBeVisible();
    await page.waitForResponse((r) => r.url().endsWith("/api/jobs"));
    await page.waitForResponse((r) => r.url().endsWith("/api/jobs"));
    await expect(old.getByRole("button", { name: "Collapse batch" })).toBeVisible();
  });

  test("the cancelled Ultra fixture job's chip reads Ultra (AC-29)", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    const group = batch(page, "an ornate dragon statue");
    await group.getByRole("button", { name: "Expand batch" }).click();
    const row = group.getByTestId("job").filter({ hasText: "an ornate dragon statue" });
    await expect(row.getByTestId("job-state")).toHaveText("Cancelled");
    await expect(row).toContainText("Ultra");
    await expect(row).not.toContainText("30k");
    await expect(row).toContainText("4096");
  });

  test("Cancel all cancels every unfinished job of the batch", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    const set = batch(page, "a mossy stone well");
    await set.getByRole("button", { name: "Cancel all" }).click();
    await expect(set.getByTestId("job-state").filter({ hasText: /^(Generating|Queued|Waiting)$/ })).toHaveCount(0, { timeout: 60_000 });
    await expect(set.getByTestId("job-state").filter({ hasText: "Cancelled" })).toHaveCount(2);
  });
});

test.describe("at the unfinished limit", () => {
  let stack: Stack;
  test.beforeAll(async () => {
    stack = await startStack("queue-limit", "default", { unfinishedJobs: 3 });
  });
  test.afterAll(async () => {
    await stack.stop();
  });

  test("Retry failed retries what fits and reports how many were refused", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    const old = batch(page, "a wooden treasure chest");
    await old.getByRole("button", { name: "Retry failed" }).click();
    await expect(old.getByRole("alert")).toHaveText("2 of 3 jobs could not be retried.", { timeout: 30_000 });
  });
});

test.describe("an Ultra batch on its own stack", () => {
  let stack: Stack;
  test.beforeAll(async () => {
    stack = await startStack("queue-ultra", "empty");
  });
  test.afterAll(async () => {
    await stack.stop();
  });

  test("finishes against the fake and its preview shows Ultra (30k triangles) (AC-29)", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    await page.getByLabel("Detail", { exact: true }).getByRole("radio", { name: "Ultra 30k" }).click();
    await page.getByLabel("Prompts").fill("an ultra lantern");
    await page.getByRole("button", { name: /^Generate/ }).click();
    const asset = page.getByTestId("asset").filter({ hasText: "an ultra lantern" });
    await expect(asset).toHaveCount(1, { timeout: 60_000 });
    await asset.getByRole("button", { name: /^Preview/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Ultra (30k triangles)");
  });
});
