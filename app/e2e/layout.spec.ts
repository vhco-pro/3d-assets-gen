import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, shared, test } from "./fixtures.ts";

// Viewport matrix from the feature documents; 640x450 is the reflow equivalent of 1280x900 at 200 percent.
// Below 1024 pixels the page is the phone shell (asset-studio-mobile); from 1024 it keeps the two columns.
const PHONE_VIEWPORTS: [number, number][] = [[320, 568], [390, 844], [390, 667], [844, 390], [768, 1024], [640, 450]];
const WIDE_VIEWPORTS: [number, number][] = [[1024, 768], [1280, 720], [1440, 900]];
const SHOTS = join(import.meta.dirname, "..", "..", ".artifacts", "screens");

async function checkLayout(page: Page, opts: { hitArea?: boolean } = {}): Promise<void> {
  const report = await page.evaluate((hitArea) => {
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
      // Radix keeps a hidden native input beside its checkbox for forms; it is not exposed to anyone.
      if (el.closest("[aria-hidden='true']")) continue;
      const input = el as HTMLInputElement;
      const named = input.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el.tagName === "BUTTON" && el.textContent.trim());
      if (input.type !== "hidden" && !named) problems.push(`unnamed control: ${el.outerHTML.slice(0, 60)}`);
    }
    if (hitArea) {
      // The phone shell: every control's hit area (the control or a label that activates it) is at least 44 by 44.
      for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=checkbox], [role=switch], [role=radio]")) {
        if (el.closest("[aria-hidden='true']") || (el as HTMLInputElement).type === "hidden" || !visible(el)) continue;
        if (el.matches("input") && getComputedStyle(el).position === "absolute" && el.getBoundingClientRect().width <= 1) continue;
        const boxes = [el, ...Array.from((el as HTMLInputElement).labels ?? []), el.closest("label")].filter((x): x is Element => x !== null).map((x) => x.getBoundingClientRect());
        const ok = boxes.some((b) => b.width >= 44 - 0.5 && b.height >= 44 - 0.5);
        if (!ok) {
          const b = el.getBoundingClientRect();
          problems.push(`hit area below 44x44 (${b.width.toFixed(0)}x${b.height.toFixed(0)}): ${(el.getAttribute("aria-label") ?? el.textContent).trim().slice(0, 30) || el.outerHTML.slice(0, 50)}`);
        }
      }
    }
    return problems;
  }, opts.hitArea ?? false);
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
          // A fully transparent border is no boundary (shadcn's Switch keeps one); its fill is checked as text-free UI.
          if (parse(s.borderTopColor)[3] === 0) continue;
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
  const vp = page.viewportSize();
  // The page may still be laying out (the job list arriving); scroll again until the settled position is inside.
  // A partly visible button counts as in view for scrollIntoViewIfNeeded, so scroll it fully into view (the
  // phone shell's scroll padding keeps it above the tab bar) and require it clear of the tab bar too.
  await expect.poll(async () => {
    await action.evaluate((el) => { el.scrollIntoView({ block: "nearest" }); });
    const box = await action.boundingBox();
    const nav = page.getByRole("navigation", { name: "Screens" });
    const bar = (await nav.count()) > 0 ? await nav.boundingBox() : null;
    const bottom = bar ? bar.y : (vp?.height ?? 0);
    return Boolean(box && vp && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= bottom);
  }, { message: `${String(name)} inside ${JSON.stringify(vp)} and above the tab bar` }).toBe(true);
}

for (const [w, h] of WIDE_VIEWPORTS) {
  test(`sign-in, submit, queue and library in two columns at ${String(w)}x${String(h)} @webkit`, async ({ page }) => {
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
    // Two columns: the composer beside the queue and library.
    const composer = await page.getByTestId("composer").boundingBox();
    const library = await page.getByRole("heading", { name: "Library" }).boundingBox();
    expect(composer && library && composer.x + composer.width <= library.x).toBeTruthy();
    await expect(page.getByRole("navigation", { name: "Screens" })).toHaveCount(0);
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
    await expect(page.locator('[role="dialog"] model-viewer')).toBeVisible({ timeout: 60_000 });
    await checkLayout(page);
    await dialogActionsInside(page);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-preview.png`) });
  });
}

for (const [w, h] of PHONE_VIEWPORTS) {
  test(`sign-in, each tab and the Asset page in the phone shell at ${String(w)}x${String(h)} @webkit`, async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    const s = shared();
    const tabs = page.getByRole("navigation", { name: "Screens" });
    await page.setViewportSize({ width: w, height: h });
    await page.goto(s.url);
    await checkLayout(page);
    await primaryActionReachable(page, "Sign in");
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-signin.png`), fullPage: true });
    await page.getByLabel("Access token").fill(s.token);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(tabs).toBeVisible();
    await checkLayout(page, { hitArea: true });
    await primaryActionReachable(page, /^Generate/);
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-create.png`), fullPage: true });
    await page.getByLabel("Prompts").fill(`layout ${String(w)}x${String(h)} ${Math.random().toString(36).slice(2, 8)}`);
    await page.getByRole("button", { name: /^Generate/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 job added" })).toBeVisible();
    await checkLayout(page, { hitArea: true });
    for (const name of ["Queue", "Library"]) {
      await tabs.getByRole("link", { name }).click();
      await expect(page.locator(`[data-screen="${name.toLowerCase()}"]`)).toBeVisible();
      await checkLayout(page, { hitArea: true });
      await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-${name.toLowerCase()}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await checkLayout(page, { hitArea: true });
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByTestId("asset").first().getByRole("button", { name: /^Open / }).click();
    await expect(page.getByTestId("asset-page").locator("model-viewer")).toBeVisible({ timeout: 60_000 });
    await checkLayout(page, { hitArea: true });
    await page.screenshot({ path: join(SHOTS, `${String(w)}x${String(h)}-asset.png`), fullPage: true });
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
  const viewer = page.locator('[role="dialog"] model-viewer');
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  expect(await viewer.evaluate((el) => el.hasAttribute("auto-rotate"))).toBe(false);
  await expect(viewer).toHaveAttribute("interpolation-decay", "0");
});


/** The open preview dialog keeps Close and Download inside the viewport (Design > Page). */
async function dialogActionsInside(page: Page): Promise<void> {
  const vp = page.viewportSize();
  for (const name of ["Close", /^Download/]) {
    // After a resize the dialog and its viewer re-lay out; wait for the settled position, not the first frame.
    await expect.poll(async () => {
      const b = await page.getByRole("dialog").getByRole("button", { name }).boundingBox();
      return Boolean(b && vp && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height);
    }, { message: `${String(name)} inside ${JSON.stringify(vp)}` }).toBe(true);
  }
}

test("the open preview dialog survives resizes above 1024 pixels with Close and Download inside", async ({ page }) => {
  const s = shared();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(s.url);
  await page.getByLabel("Access token").fill(s.token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Below 1024 pixels the dialog closes (the phone shell's rule); short and narrow wide sizes keep it.
  for (const [w, h] of [[1024, 600], [1100, 480]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await dialogActionsInside(page);
    await checkLayout(page);
  }
});
