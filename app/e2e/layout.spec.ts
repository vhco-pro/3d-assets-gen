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
  await checkContrast(page);
}

/**
 * Design > Page contrast rules: text at least 4.5:1 (3:1 when large), control borders at least 3:1, measured
 * against the composited background (each ancestor's background with alpha above zero, blended down to the
 * page gradient) at both the darkest and the lightest gradient stop. Disabled controls are exempt.
 */
async function checkContrast(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    type C = [number, number, number, number];
    const parse = (s: string): C => {
      const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(s);
      return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : [0, 0, 0, 0];
    };
    const over = (top: C, base: C): C => [0, 1, 2].map((i) => (top[i] ?? 0) * top[3] + (base[i] ?? 0) * (1 - top[3])).concat(1) as C;
    const lum = (c: C): number => {
      const f = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (a: C, b: C): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05); };
    const backdrop = (el: Element | null, stop: C): C => {
      const chain: C[] = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) chain.push(bg);
      }
      return chain.reverse().reduce((acc, c) => over(c, acc), stop);
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0";
    };
    const stops: C[] = [[2, 8, 20, 1], [11, 31, 69, 1]];
    const out: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("model-viewer, [disabled], [aria-disabled='true']") || !visible(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const s = getComputedStyle(el);
      for (const stop of stops) {
        if (own) {
          const bg = backdrop(el, stop);
          const size = parseFloat(s.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
          const r = ratio(over(parse(s.color), bg), bg);
          if (r < (large ? 3 : 4.5)) out.push(`text ${r.toFixed(2)}: ${el.textContent.trim().slice(0, 30)}`);
        }
        if (el.matches("button, input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea, [data-control]") && parseFloat(s.borderTopWidth) > 0) {
          const outside = backdrop(el.parentElement, stop);
          const border = over(parse(s.borderTopColor), outside);
          const r = ratio(border, outside);
          if (r < 3) out.push(`border ${r.toFixed(2)}: ${el.tagName} ${el.textContent.trim().slice(0, 30)}`);
        }
      }
    }
    return [...new Set(out)];
  });
  expect(problems).toEqual([]);
}

async function primaryActionReachable(page: Page, name: string | RegExp): Promise<void> {
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
    await primaryActionReachable(page, /^Generate/);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-main.png`), fullPage: true });
    // The submit journey: a new job in the queue and the confirmation, then the library's preview panel.
    await page.getByLabel("Prompts").fill(`layout ${String(w)}x${String(h)} ${Math.random().toString(36).slice(2, 8)}`);
    await page.getByRole("button", { name: /^Generate/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 job added" })).toBeVisible();
    await checkLayout(page);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-submitted.png`), fullPage: true });
    await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
    await expect(page.locator("dialog[open] model-viewer")).toBeVisible({ timeout: 60_000 });
    await checkLayout(page);
    await dialogActionsInside(page);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-preview.png`) });
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
    if (await page.getByRole("button", { name: /^Generate/ }).evaluate((el) => el === document.activeElement)) break;
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
  const viewer = page.locator("dialog[open] model-viewer");
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  expect(await viewer.evaluate((el) => el.hasAttribute("auto-rotate"))).toBe(false);
  await expect(viewer).toHaveAttribute("interpolation-decay", "0");
});


/** The open preview dialog keeps Close and Download inside the viewport (Design > Page). */
async function dialogActionsInside(page: Page): Promise<void> {
  const vp = page.viewportSize();
  for (const name of ["Close", /^Download/]) {
    const b = await page.locator("dialog[open]").getByRole("button", { name }).boundingBox();
    expect(b && vp && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `${String(name)} inside ${JSON.stringify(vp)}`).toBeTruthy();
  }
}

test("the open preview dialog survives resizes with Close and Download inside", async ({ page }) => {
  const s = shared();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(s.url);
  await page.getByLabel("Access token").fill(s.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
  for (const [w, h] of [[390, 844], [844, 390]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await dialogActionsInside(page);
    await checkLayout(page);
  }
});
