import { expandBatches, expect, signIn, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

const STATES = ["Waiting", "Queued", "Generating", "Done", "Failed", "Cancelled"];
const FIELDS = ["Quality", "Variants", "Game-asset style", "Seed", "Shared style"];
const LEVELS = ["Fast", "Standard", "High", "Ultra"];

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
  // Quality and its four levels replace Detail and Texture (asset-studio-mobile, Glossary).
  for (const level of LEVELS) await expect(page.getByLabel("Quality", { exact: true }).getByRole("radio", { name: level, exact: true })).toHaveCount(1);
  await expect(page.getByText("Detail", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Texture", { exact: true })).toHaveCount(0);
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

test("the phone layout uses the Glossary terms for the tabs, Quality and the Asset page's actions @android @mobile-only", async ({ page }) => {
  await page.goto(stack.url);
  await page.getByLabel("Access token").fill(stack.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  const tabs = page.getByRole("navigation", { name: "Screens" });
  for (const name of ["Create", "Queue", "Library"]) await expect(tabs.getByRole("link", { name, exact: true })).toHaveCount(1);
  for (const level of LEVELS) await expect(page.getByLabel("Quality", { exact: true }).getByRole("radio", { name: level, exact: true })).toHaveCount(1);
  await expect(page.getByText("Detail", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Texture", { exact: true })).toHaveCount(0);
  await tabs.getByRole("link", { name: "Library" }).click();
  await page.getByRole("button", { name: "Open a wooden treasure chest" }).click();
  const asset = page.getByTestId("asset-page");
  for (const action of ["Download", "Remix", "Delete"]) await expect(asset.getByRole("button", { name: action, exact: true })).toHaveCount(1);
  await expect(asset.getByText(/^Quality: /)).toHaveCount(1);
  // The Pixel 7 profile's Android user agent makes model-viewer offer Scene Viewer.
  await expect(asset.locator("model-viewer")).toHaveAttribute("data-loaded", "true", { timeout: 60_000 });
  await expect(asset.getByRole("button", { name: "View in your room" })).toBeVisible();
  await expect(page.getByText("Detail", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Texture", { exact: true })).toHaveCount(0);
});
