import { expect, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

// Runs in its own projects against its own container: the wrong tokens here use the failure budget.
let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack("signin", "default");
});
test.afterAll(async () => {
  await stack.stop();
});

test("signing in works, survives a reload, and a wrong token shows an error", async ({ page }) => {
  await page.goto(stack.url);
  await page.getByLabel("Access token").fill("not-the-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("token");
  await page.getByLabel("Access token").fill(stack.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});

test("after a token rotation the page returns to sign-in and stops polling", async ({ page }) => {
  await page.goto(stack.url);
  await page.getByLabel("Access token").fill(stack.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  const fresh = await stack.rotateToken();
  await expect(page.getByLabel("Access token")).toBeVisible({ timeout: 60_000 });
  let jobRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/jobs")) jobRequests++;
  });
  await page.waitForTimeout(20_000);
  expect(jobRequests).toBe(0);
  await page.getByLabel("Access token").fill(fresh);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
});
