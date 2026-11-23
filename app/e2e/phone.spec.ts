// Journeys of the installable phone app (feature document asset-studio-mobile). Tags place each journey in
// its projects: @phone (both phone projects), @android (phone-chromium), @ios (phone-webkit), @firefox,
// @webkit (webkit-desktop) and @mobile-only (never in the desktop chromium project).
import { chromium, type Locator, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, shared, signIn, test, uniquePrompt } from "./fixtures.ts";

test.describe("installable", () => {
  test("the image serves the manifest, its icons and /sw.js, and Chromium reports no installability errors", async ({ request }) => {
    const { url } = shared();
    const manifestRes = await request.get(`${url}/manifest.webmanifest`);
    expect(manifestRes.status()).toBe(200);
    expect(manifestRes.headers()["content-type"]).toBe("application/manifest+json");
    const manifest = (await manifestRes.json()) as { name: string; short_name: string; start_url: string; scope: string; display: string; background_color: string; theme_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[] };
    expect(manifest).toMatchObject({ name: "Asset Studio", short_name: "Asset Studio", start_url: "/", scope: "/", display: "standalone", background_color: "#020814", theme_color: "#020814" });
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose ?? "any"}`).sort()).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of [...manifest.icons.map((i) => i.src), "/apple-touch-icon.png"]) {
      const res = await request.get(new URL(icon, url).toString());
      expect(res.status(), icon).toBe(200);
      expect(res.headers()["content-type"], icon).toBe("image/png");
    }
    const sw = await request.get(`${url}/sw.js`);
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toBe("text/javascript");
    expect(sw.headers()["cache-control"]).toBe("no-cache");

    // The installability check needs full Chromium (not the headless shell) and a secure context: localhost.
    const local = url.replace("127.0.0.1", "localhost");
    const dir = mkdtempSync(join(tmpdir(), "asset-studio-install-"));
    const context = await chromium.launchPersistentContext(dir, { channel: "chromium" });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      const errorsFor = async (target: string): Promise<unknown[]> => {
        await page.goto(target);
        const cdp = await context.newCDPSession(page);
        // The manifest is fetched after load; give Chromium a moment, then ask until the answer settles.
        let last: unknown[] = ["not checked"];
        for (let i = 0; i < 20; i++) {
          last = ((await cdp.send("Page.getInstallabilityErrors")) as { installabilityErrors: unknown[] }).installabilityErrors;
          if (last.length === 0) break;
          await page.waitForTimeout(250);
        }
        await cdp.detach();
        return last;
      };
      expect(await errorsFor(`${local}/`)).toEqual([]);
      expect((await errorsFor(`${local}/api/health`)).length).toBeGreaterThan(0);
    } finally {
      await context.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the service worker controls the page after its first registration, without a reload", async ({ page }) => {
    const { url, token } = shared();
    await signIn(page, url, token);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);
  });
});

// ---- the phone shell (AC-02, AC-03) ---------------------------------------------------------------------

const fixture = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Seeded done asset "a wooden treasure chest". */
const CHEST = fixture(1);
/** Seeded failed job "a cursed lantern". */
const FAILED = fixture(5);
const GONE = "This asset is no longer available.";
const EXPORT_GONE = "The selection changed after the export started. Select the assets again and download them.";

const tabBar = (page: Page): Locator => page.getByRole("navigation", { name: "Screens" });
const tab = (page: Page, name: "Create" | "Queue" | "Library"): Locator => tabBar(page).getByRole("link", { name, exact: true });
const screen = (page: Page): Locator => page.locator("[data-screen]:visible");
const query = (page: Page): URLSearchParams => new URL(page.url()).searchParams;

/** Signs in on the phone shell, where Create is the first screen. */
async function phoneSignIn(page: Page): Promise<void> {
  const { url, token } = shared();
  await page.goto(url);
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(tabBar(page)).toBeVisible();
}

/** Signs in, then commits an about:blank entry, so history-length and Back checks have a fixed start. */
async function fromBlank(page: Page): Promise<number> {
  await phoneSignIn(page);
  await page.goto("about:blank");
  return page.evaluate(() => history.length);
}

/** Queues one prompt through the API and waits until the fake has finished it. */
async function doneJob(label: string): Promise<{ id: string; prompt: string }> {
  const { url, token } = shared();
  const prompt = uniquePrompt(label);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-batch-id": crypto.randomUUID() };
  const res = await fetch(`${url}/api/batches`, { method: "POST", headers, body: JSON.stringify({ kind: "prompt", prompts: [prompt], presets: { faces: 5000, tex: 1024, variants: 1, style: true, seed: null } }) });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { batch: { jobs: { id: string }[] } }).batch.jobs[0]?.id ?? "";
  await expect.poll(async () => {
    const r = await fetch(`${url}/api/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } });
    return ((await r.json()) as { job: { state: string } }).job.state;
  }, { timeout: 60_000 }).toBe("done");
  return { id, prompt };
}

test.describe("phone shell", () => {
  test("tabs: Create first, one screen at a time, the current tab marked, kept on reload, no history entries @phone @mobile-only", async ({ page }) => {
    const base = await fromBlank(page);
    await page.goto(shared().url);
    await expect(screen(page)).toHaveCount(1);
    await expect(screen(page)).toHaveAttribute("data-screen", "create");
    await expect(page.getByRole("heading", { level: 1, name: "Create" })).toBeVisible();
    for (const name of ["Create", "Queue", "Library"] as const) {
      await tab(page, name).click();
      await expect(screen(page)).toHaveCount(1);
      await expect(screen(page)).toHaveAttribute("data-screen", name.toLowerCase());
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      expect(query(page).get("tab")).toBe(name.toLowerCase());
      await expect(tabBar(page).locator('[aria-current="page"]')).toHaveCount(1);
      await expect(tab(page, name)).toHaveAttribute("aria-current", "page");
      await expect(tabBar(page).locator("[data-accent]:visible")).toHaveCount(1);
      await expect(tab(page, name).locator("[data-accent]")).toBeVisible();
    }
    expect(await page.evaluate(() => history.length)).toBe(base + 1);
    await tab(page, "Queue").click();
    await page.reload();
    await expect(screen(page)).toHaveAttribute("data-screen", "queue");
    await tab(page, "Library").click();
    await page.goBack();
    expect(page.url()).toBe("about:blank");
  });

  test("keyboard: with the Prompts field focused and a short viewport, Generate scrolls into view above the tab bar @phone @mobile-only", async ({ page }) => {
    await phoneSignIn(page);
    await page.getByLabel("Prompts").fill("a mossy stone well");
    await page.getByLabel("Prompts").focus();
    await page.setViewportSize({ width: 390, height: 500 });
    const generate = page.getByRole("button", { name: /^Generate/ });
    await generate.scrollIntoViewIfNeeded();
    const g = await generate.boundingBox();
    const bar = await tabBar(page).boundingBox();
    if (!g || !bar) throw new Error("no layout boxes");
    expect(g.y + g.height).toBeLessThanOrEqual(bar.y);
    expect(g.y).toBeGreaterThanOrEqual(0);
  });

  test("asset page: a tile opens it, Back and ‹ Library return, links open it, resizes close it, unknown IDs are gone @phone @mobile-only", async ({ page }) => {
    await phoneSignIn(page);
    await tab(page, "Library").click();
    await page.getByRole("button", { name: "Open a wooden treasure chest" }).click();
    const asset = page.getByTestId("asset-page");
    await expect(asset).toBeVisible();
    expect(query(page).get("asset")).toBe(CHEST);
    await expect(asset.locator("model-viewer")).toHaveAttribute("data-loaded", "true", { timeout: 60_000 });
    await expect(asset.getByRole("heading", { level: 2, name: "a wooden treasure chest" })).toBeVisible();
    for (const term of ["Generated in", "Seed", "Created"]) await expect(asset.getByText(term, { exact: true })).toBeVisible();
    for (const action of ["Download", "Delete"]) await expect(asset.getByRole("button", { name: action, exact: true })).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    await expect(tab(page, "Library")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "‹ Library" })).toBeVisible();
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");

    // Opened directly: ‹ Library stays inside the app, and Back afterwards leaves it.
    const base = await fromBlank(page);
    await page.goto(`${shared().url}/?asset=${CHEST}`);
    await expect(page.getByTestId("asset-page")).toBeVisible();
    await page.getByRole("button", { name: "‹ Library" }).click();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    expect(query(page).get("tab")).toBe("library");
    expect(await page.evaluate(() => history.length)).toBe(base + 1);
    await page.goBack();
    expect(page.url()).toBe("about:blank");

    // Leaving a tile-opened asset by another tab keeps the Library entry once.
    await fromBlank(page);
    await page.goto(`${shared().url}/?tab=library`);
    await page.getByRole("button", { name: "Open a wooden treasure chest" }).click();
    await expect(page.getByTestId("asset-page")).toBeVisible();
    await tab(page, "Queue").click();
    await expect(screen(page)).toHaveAttribute("data-screen", "queue");
    expect(query(page).get("tab")).toBe("queue");
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await page.goBack();
    expect(page.url()).toBe("about:blank");

    // Unknown and unfinished assets.
    for (const id of [crypto.randomUUID(), FAILED]) {
      await page.goto(`${shared().url}/?asset=${id}`);
      await expect(page.getByText(GONE)).toBeVisible();
      await page.getByRole("button", { name: "Back to Library" }).click();
      await expect(screen(page)).toHaveAttribute("data-screen", "library");
    }

    // Crossing 1024 pixels closes the open asset view either way, without a history entry.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`${shared().url}/?tab=library`);
    await page.getByRole("button", { name: "Open a wooden treasure chest" }).click();
    await expect(page.getByTestId("asset-page")).toBeVisible();
    let length = await page.evaluate(() => history.length);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("asset-page")).toHaveCount(0);
    await expect.poll(() => query(page).get("tab")).toBe("library");
    expect(query(page).get("asset")).toBeNull();
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    expect(await page.evaluate(() => history.length)).toBe(length);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole("button", { name: "Preview a wooden treasure chest" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    length = await page.evaluate(() => history.length);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(query(page).get("tab")).toBe("library");
    expect(await page.evaluate(() => history.length)).toBe(length);
  });

  test("export gone: the notice opens on the Library tab, the address is cleaned at once, and Dismiss hides it for good @phone @mobile-only", async ({ page }) => {
    const base = await fromBlank(page);
    await page.goto(`${shared().url}/?export=gone`);
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await expect(page.getByText(EXPORT_GONE)).toBeVisible();
    expect(new URL(page.url()).search).toBe("?tab=library");
    expect(await page.evaluate(() => history.length)).toBe(base + 1);
    await page.getByRole("button", { name: "Open a wooden treasure chest" }).click();
    await expect(page.getByTestId("asset-page")).toBeVisible();
    expect(query(page).get("export")).toBeNull();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText(EXPORT_GONE)).toHaveCount(0);
    await expect(page.getByTestId("asset-page")).toBeVisible();
    await page.goBack();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await expect(page.getByText(EXPORT_GONE)).toHaveCount(0);
    await page.reload();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await expect(page.getByText(EXPORT_GONE)).toHaveCount(0);
  });

  test("delete: Delete on the Asset page returns to the Library without the asset @android @mobile-only", async ({ page }) => {
    const { id, prompt } = await doneJob("phone delete");
    await phoneSignIn(page);
    await page.goto(`${shared().url}/?asset=${id}`);
    await expect(page.getByTestId("asset-page")).toBeVisible();
    await page.getByTestId("asset-page").getByRole("button", { name: "Delete", exact: true }).click();
    await expect(screen(page)).toHaveAttribute("data-screen", "library");
    await expect(page.getByRole("button", { name: `Open ${prompt}` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open a wooden treasure chest" })).toBeVisible();
  });

  test("reduced motion: the Asset page's viewer stops easing when the system asks for less motion @android @mobile-only", async ({ page }) => {
    await phoneSignIn(page);
    await page.goto(`${shared().url}/?asset=${CHEST}`);
    const viewer = page.getByTestId("asset-page").locator("model-viewer");
    await expect(viewer).toHaveAttribute("interpolation-decay", "200");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(viewer).toHaveAttribute("interpolation-decay", "0");
  });
});

test.describe("asset links on the desktop", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("asset link desktop: ?asset= opens the Preview dialog, tiles keep the URL, unknown IDs and export=gone show notices @firefox @webkit", async ({ page }) => {
    const { url, token } = shared();
    await signIn(page, url, token);
    await page.goto(`${url}/?asset=${CHEST}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("full-prompt")).toHaveText("a wooden treasure chest");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    expect(query(page).get("asset")).toBeNull();

    await page.goto("about:blank");
    await page.goto(url);
    await page.getByRole("button", { name: "Preview a wooden treasure chest" }).click();
    await expect(dialog).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.goBack();
    expect(page.url()).toBe("about:blank");

    await page.goto(`${url}/?asset=${crypto.randomUUID()}`);
    await expect(page.getByText(GONE)).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();

    await page.goto(`${url}/?export=gone`);
    await expect(page.getByText(EXPORT_GONE)).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/");
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText(EXPORT_GONE)).toHaveCount(0);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/");
  });
});
