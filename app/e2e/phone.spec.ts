// Journeys of the installable phone app (feature document asset-studio-mobile). Tags place each journey in
// its projects: @phone (both phone projects), @android (phone-chromium), @ios (phone-webkit), @firefox,
// @webkit (webkit-desktop) and @mobile-only (never in the desktop chromium project).
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, shared, signIn, test } from "./fixtures.ts";

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
