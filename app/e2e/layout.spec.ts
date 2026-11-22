import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, shared, test } from "./fixtures.ts";

// Viewport matrix from the feature document; 640x450 is the reflow equivalent of 1280x900 at 200 percent.
const VIEWPORTS: [number, number][] = [[320, 568], [390, 844], [390, 667], [844, 390], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [640, 450]];
const SHOTS = join(import.meta.dirname, "..", "..", ".artifacts", "screens");

async function checkLayout(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const problems: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) problems.push(`horizontal overflow ${String(doc.scrollWidth)} > ${String(doc.clientWidth)}`);
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    for (const el of document.querySelectorAll("p, li, label, span, td, dd")) {
      if (!visible(el) || !el.textContent.trim()) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) problems.push(`text below 14px (${String(size)}): ${el.textContent.trim().slice(0, 30)}`);
    }
    for (const el of document.querySelectorAll("button, label")) {
      if (visible(el) && el.scrollWidth > el.clientWidth + 1) problems.push(`clipped: ${el.textContent.trim().slice(0, 30)}`);
    }
    const probe = document.createElement("canvas").getContext("2d");
    for (const el of document.querySelectorAll("[data-testid=prompt-text]")) {
      if (!visible(el) || !probe) continue;
      const style = getComputedStyle(el);
      probe.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const ninety = probe.measureText("0".repeat(90)).width;
      if (el.getBoundingClientRect().width > ninety + 2) problems.push(`prompt line wider than 90 characters: ${el.textContent.slice(0, 30)}`);
    }
    for (const el of document.querySelectorAll("button, input, select, textarea")) {
      const input = el as HTMLInputElement;
      const named = input.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el.tagName === "BUTTON" && el.textContent.trim());
      if (input.type !== "hidden" && !named) problems.push(`unnamed control: ${el.outerHTML.slice(0, 60)}`);
    }
    return problems;
  });
  expect(report).toEqual([]);
}

async function primaryActionReachable(page: Page, name: string): Promise<void> {
  const action = page.getByRole("button", { name });
  await action.scrollIntoViewIfNeeded();
  const box = await action.boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height).toBeTruthy();
}

for (const [w, h] of VIEWPORTS) {
  test(`sign-in, submit, queue and library at ${String(w)}x${String(h)}`, async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    const s = shared();
    await page.setViewportSize({ width: w, height: h });
    await page.goto(s.url);
    await checkLayout(page);
    await primaryActionReachable(page, "Sign in");
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-signin.png`), fullPage: true });
    await page.getByLabel("Access token").fill(s.token);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await checkLayout(page);
    await primaryActionReachable(page, "Generate");
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-main.png`), fullPage: true });
    // The submit journey: a new job in the queue and the confirmation, then the library's preview panel.
    await page.getByLabel("Prompts").fill(`layout ${String(w)}x${String(h)} ${Math.random().toString(36).slice(2, 8)}`);
    await page.getByRole("button", { name: "Generate" }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 job added" })).toBeVisible();
    await checkLayout(page);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-submitted.png`), fullPage: true });
    await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
    await expect(page.locator("model-viewer")).toBeVisible({ timeout: 60_000 });
    await checkLayout(page);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-preview.png`), fullPage: true });
  });
}

test("sign-in and submit complete by keyboard alone", async ({ page }) => {
  const s = shared();
  await page.goto(s.url);
  await expect(page.getByLabel("Access token")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Access token")).toBeFocused();
  await page.keyboard.type(s.token);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await page.getByLabel("Prompts").focus();
  await page.keyboard.type(`keyboard ${Math.random().toString(36).slice(2, 8)}`);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("button", { name: "Generate" }).evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "1 job added" })).toBeVisible();
});

test("the library and viewer work with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const s = shared();
  await page.goto(s.url);
  await page.getByLabel("Access token").fill(s.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
  const viewer = page.locator("model-viewer");
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  expect(await viewer.evaluate((el) => el.hasAttribute("auto-rotate"))).toBe(false);
  await expect(viewer).toHaveAttribute("interpolation-decay", "0");
});
