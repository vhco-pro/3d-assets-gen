import { expect, signIn, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

const banner = (page: import("@playwright/test").Page): import("@playwright/test").Locator => page.getByTestId("comfy-banner-term");

test.describe("with unfinished jobs", () => {
  let stack: Stack;
  test.beforeAll(async () => {
    stack = await startStack("offline", "default");
  });
  test.afterAll(async () => {
    await stack.stop();
  });

  test("the offline banner appears and clears", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    await stack.stopFake();
    await expect(banner(page)).toHaveText("ComfyUI offline", { timeout: 60_000 });
    await stack.startFake();
    await expect(banner(page)).toHaveCount(0, { timeout: 120_000 });
  });

  test("the incompatible banner appears and clears", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    await stack.control("version", { version: "0.46.1" });
    await expect(banner(page)).toHaveText("ComfyUI incompatible", { timeout: 60_000 });
    await stack.control("version", { version: "0.46.2" });
    await expect(banner(page)).toHaveCount(0, { timeout: 60_000 });
  });
});

test.describe("on the empty profile", () => {
  let stack: Stack;
  test.beforeAll(async () => {
    stack = await startStack("offline-empty", "empty");
  });
  test.afterAll(async () => {
    await stack.stop();
  });

  test("the offline banner appears and clears with no jobs at all", async ({ page }) => {
    await signIn(page, stack.url, stack.token);
    await expect(page.getByText("No assets yet")).toBeVisible();
    await stack.stopFake();
    await expect(banner(page)).toHaveText("ComfyUI offline", { timeout: 60_000 });
    await stack.startFake();
    await expect(banner(page)).toHaveCount(0, { timeout: 120_000 });
  });
});
