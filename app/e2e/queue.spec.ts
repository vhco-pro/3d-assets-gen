import { expect, fakeControl, shared, signIn, test, uniquePrompt } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  const s = shared();
  await signIn(page, s.url, s.token);
});

test("a job reaches Done and is still there after a reload", async ({ page }) => {
  const prompt = uniquePrompt("queue");
  await page.getByLabel("Prompts").fill(prompt);
  await page.getByRole("button", { name: /^Generate/ }).click();
  const asset = page.getByTestId("asset").filter({ hasText: prompt });
  await expect(asset).toHaveCount(1, { timeout: 60_000 });
  await expect(asset.getByTestId("job-state")).toHaveText("Done");
  await page.reload();
  await expect(page.getByTestId("asset").filter({ hasText: prompt })).toHaveCount(1);
});

test("a job can be cancelled and retried through the page", async ({ page }) => {
  const s = shared();
  const marker = uniquePrompt("HOLD");
  await fakeControl(s.fakeUrl, "hold-matching", marker);
  try {
    await page.getByLabel("Prompts").fill(marker);
    await page.getByRole("button", { name: /^Generate/ }).click();
    const job = page.getByTestId("job").filter({ hasText: marker });
    await expect(job.getByTestId("job-state")).toHaveText(/Queued|Generating/, { timeout: 60_000 });
    await job.getByRole("button", { name: "Cancel" }).click();
    await expect(job.getByTestId("job-state")).toHaveText("Cancelled", { timeout: 60_000 });
    await job.getByRole("button", { name: "Retry" }).click();
    await expect(job.getByTestId("job-state")).toHaveText(/Waiting|Queued|Generating/, { timeout: 60_000 });
  } finally {
    await fakeControl(s.fakeUrl, "release-matching", marker);
  }
  await expect(page.getByTestId("asset").filter({ hasText: marker })).toHaveCount(1, { timeout: 60_000 });
});
