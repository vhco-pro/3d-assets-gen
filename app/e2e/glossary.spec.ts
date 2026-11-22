import { expandBatches, expect, signIn, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

const STATES = ["Waiting", "Queued", "Generating", "Done", "Failed", "Cancelled"];
const FIELDS = ["Detail", "Texture", "Variants", "Game-asset style", "Seed", "Shared style"];

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack("glossary", "default");
});
test.afterAll(async () => {
  await stack.stop();
});

test("job states, preset fields, banners and the library heading use the Glossary terms", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  await expandBatches(page);
  const states = await page.getByTestId("job-state").allTextContents();
  expect(states.length).toBeGreaterThan(0);
  for (const s of states) expect(STATES).toContain(s);
  for (const expected of ["Done", "Failed", "Cancelled", "Generating", "Queued"]) expect(states).toContain(expected);
  for (const field of FIELDS) await expect(page.getByLabel(field, { exact: true })).toHaveCount(1);
  // TRELLIS.2 is the only engine, so the form offers no engine choice (AC-23).
  await expect(page.getByLabel("Engine", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Hunyuan/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await stack.control("version", { version: "0.46.1" });
  await expect(page.getByTestId("comfy-banner-term")).toHaveText("ComfyUI incompatible", { timeout: 60_000 });
  await stack.control("version", { version: "0.46.2" });
  await stack.stopFake();
  await expect(page.getByTestId("comfy-banner-term")).toHaveText("ComfyUI offline", { timeout: 60_000 });
  await stack.startFake();
});
