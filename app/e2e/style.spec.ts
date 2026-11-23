// VH Midnight style checks (AC-22). This spec starts its own stack because it stops and changes the fake.
import type { Locator, Page } from "@playwright/test";
import { expandBatches, expect, signIn, test } from "./fixtures.ts";
import { startStack, type Stack } from "./harness.ts";

// Design > Page: badge recipes with exact values.
const BADGES: Record<string, { bg: string; border: string; text: string }> = {
  Generating: { bg: "rgba(79, 140, 255, 0.15)", border: "rgba(79, 140, 255, 0.4)", text: "rgb(185, 209, 255)" },
  Done: { bg: "rgba(52, 211, 156, 0.15)", border: "rgba(52, 211, 156, 0.4)", text: "rgb(167, 240, 210)" },
  Failed: { bg: "rgba(255, 107, 107, 0.15)", border: "rgba(255, 107, 107, 0.4)", text: "rgb(255, 196, 196)" },
  Waiting: { bg: "rgba(255, 255, 255, 0.09)", border: "rgba(255, 255, 255, 0.18)", text: "rgb(159, 178, 216)" },
  Queued: { bg: "rgba(255, 255, 255, 0.09)", border: "rgba(255, 255, 255, 0.18)", text: "rgb(159, 178, 216)" },
  Cancelled: { bg: "rgba(255, 255, 255, 0.09)", border: "rgba(255, 255, 255, 0.18)", text: "rgb(159, 178, 216)" },
};

async function colours(loc: Locator): Promise<{ bg: string; border: string; text: string }> {
  return loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopColor, text: s.color };
  });
}

async function box(page: Page, testId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await page.getByTestId(testId).boundingBox();
  if (!b) throw new Error(`${testId} has no box`);
  return b;
}

let stack: Stack;
test.beforeAll(async () => {
  stack = await startStack("style", "default");
});
test.afterAll(async () => {
  await stack.stop();
});

test("tokens, the single solid Generate button and semantic colours only where Design allows", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  for (const stop of ["rgb(2, 8, 20)", "rgb(6, 18, 41)", "rgb(11, 31, 69)"]) expect(bodyBg).toContain(stop);
  expect(bodyBg).toContain("linear-gradient");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#020814");
  await page.getByLabel("Prompts").fill("style check crate");
  const generate = page.getByRole("button", { name: /^Generate/ });
  // Generate turns from disabled to enabled when text arrives; wait for its settled colour.
  await expect.poll(async () => (await colours(generate)).bg).toBe("rgb(52, 211, 156)");
  const offenders = await page.evaluate(() => {
    const semantic = /rgba?\((52, 211, 156|245, 181, 68|255, 107, 107|167, 240, 210|255, 221, 158|255, 196, 196)(, [\d.]+)?\)/;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("[data-badge], [data-banner], [data-error], [data-generate]")) continue;
      const s = getComputedStyle(el);
      for (const c of [s.color, s.backgroundColor, s.borderTopColor]) if (semantic.test(c)) out.push(`${el.tagName}.${el.className}: ${c}`);
    }
    return out;
  });
  expect(offenders).toEqual([]);
  const others = await page.locator("button:not([data-generate])").evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(others).not.toContain("rgb(52, 211, 156)");
});

test("each state badge uses Design's exact colours, including Waiting and Done", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  await expandBatches(page);
  for (const term of ["Generating", "Queued", "Failed", "Cancelled"]) {
    const badge = page.getByTestId("queue").getByTestId("job-state").filter({ hasText: new RegExp(`^${term}$`) }).first();
    expect(await colours(badge)).toEqual(BADGES[term]);
  }
  const done = page.getByTestId("asset").first().getByTestId("job-state");
  await expect(done).toHaveText("Done");
  expect(await colours(done)).toEqual(BADGES.Done);
  await stack.control("hold-accept");
  try {
    await page.getByLabel("Prompts").fill("waiting badge check");
    await page.getByRole("button", { name: /^Generate/ }).click();
    const waiting = page.getByTestId("job").filter({ hasText: "waiting badge check" }).getByTestId("job-state");
    await expect(waiting).toHaveText("Waiting", { timeout: 30_000 });
    expect(await colours(waiting)).toEqual(BADGES.Waiting);
  } finally {
    await stack.control("release-accept");
  }
});

test("the offline banner uses --danger and the incompatible banner --warn", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  await stack.stopFake();
  const banner = page.locator("[data-banner]");
  await expect(banner).toContainText("ComfyUI offline", { timeout: 60_000 });
  expect(await colours(banner)).toEqual({ bg: "rgba(255, 107, 107, 0.15)", border: "rgba(255, 107, 107, 0.4)", text: "rgb(255, 196, 196)" });
  await stack.startFake();
  await stack.control("version", { version: "0.46.1" });
  await expect(banner).toContainText("ComfyUI incompatible", { timeout: 60_000 });
  expect(await colours(banner)).toEqual({ bg: "rgba(245, 181, 68, 0.15)", border: "rgba(245, 181, 68, 0.4)", text: "rgb(255, 221, 158)" });
  await stack.control("version", { version: "0.46.2" });
  await expect(banner).toHaveCount(0, { timeout: 60_000 });
});

test("two columns from 1024 pixels, the phone shell with one screen below", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  for (const [w, h, side] of [[1280, 720, true], [1024, 768, true], [1023, 768, false], [390, 844, false]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { window.scrollTo(0, 0); });
    const composer = await box(page, "composer");
    if (side) {
      const queue = await box(page, "queue");
      expect(composer.x + composer.width, `${String(w)}x${String(h)}`).toBeLessThanOrEqual(queue.x);
    } else {
      // Below 1024 pixels Create is one screen; the queue is on its own tab.
      await expect(page.getByRole("navigation", { name: "Screens" })).toBeVisible();
      await expect(page.getByTestId("queue")).toHaveCount(0);
    }
  }
});

test("long prompts clip to two lines with the full text in the title, the dialog and the queue's More", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  const longCard = page.getByTestId("asset").filter({ hasText: "a weathered stone archway" });
  const cardText = longCard.getByTestId("prompt-text");
  const full = (await cardText.getAttribute("title")) ?? "";
  expect(full.length).toBeGreaterThan(1900);
  const clipped = await cardText.evaluate((el) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 2);
  expect(clipped).toBe(true);
  await longCard.getByRole("button", { name: /^Preview/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("full-prompt")).toHaveText(full);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expandBatches(page);
  const row = page.getByTestId("job").filter({ hasText: "a weathered stone archway" });
  const rowText = row.getByTestId("prompt-text");
  expect(await rowText.getAttribute("title")).toBe(full);
  const before = await rowText.evaluate((el) => el.getBoundingClientRect().height);
  await row.getByRole("button", { name: "More" }).click();
  await expect(rowText).toHaveText(full);
  expect(await rowText.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(before * 3);
  await row.getByRole("button", { name: "Less" }).click();
  expect(await rowText.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(before + 1);
});

test("the preview is a modal dialog that Escape closes, returning focus to its Preview button @firefox", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  const opener = page.getByTestId("asset").first().getByRole("button", { name: /^Preview/ });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("controls are shadcn components: data-slot attributes, a primary-coloured selected segment and translucent buttons (AC-25, AC-22)", async ({ page }) => {
  await signIn(page, stack.url, stack.token);
  await page.getByLabel("Prompts").fill("slot check");
  await expect(page.getByRole("button", { name: /^Generate/ })).toHaveAttribute("data-slot", "button");
  await expect(page.getByLabel("Quality", { exact: true })).toHaveAttribute("data-slot", "toggle-group");
  await expect(page.getByLabel("Game-asset style", { exact: true })).toHaveAttribute("data-slot", "switch");
  await expect(page.getByTestId("asset").first().getByRole("checkbox")).toHaveAttribute("data-slot", "checkbox");
  const selected = page.getByLabel("Quality", { exact: true }).locator("[data-state=on]");
  await expect(selected).toHaveText("Standard");
  expect(await selected.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(79, 140, 255)");
  const plain = page.getByRole("button", { name: "Download selected" });
  expect(await plain.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(255, 255, 255, 0.07)");
  await page.getByTestId("asset").first().getByRole("button", { name: /^Preview/ }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-slot", "dialog-content");
});
