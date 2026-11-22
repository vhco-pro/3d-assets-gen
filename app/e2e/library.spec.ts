import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, shared, signIn, test } from "./fixtures.ts";
import { startStack } from "./harness.ts";

/** Counts rendered pixels that differ from the corner pixel in model-viewer's own render. */
async function renderedPixels(page: import("@playwright/test").Page): Promise<number> {
  return page.locator("model-viewer").evaluate(async (el) => {
    const mv = el as HTMLElement & { toDataURL(): string };
    const img = new Image();
    img.src = mv.toDataURL();
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return 0;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let differing = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs((d[i] ?? 0) - (d[0] ?? 0)) + Math.abs((d[i + 1] ?? 0) - (d[1] ?? 0)) + Math.abs((d[i + 2] ?? 0) - (d[2] ?? 0)) > 30) differing++;
    }
    return differing;
  });
}

test("thumbnails load and the selected GLB renders in the viewer @firefox", async ({ page, consoleErrors }) => {
  const s = shared();
  await signIn(page, s.url, s.token);
  const renderer = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    return gl ? String(gl.getParameter(gl.RENDERER)) : null;
  });
  mkdirSync(join(import.meta.dirname, "..", "..", ".artifacts"), { recursive: true });
  appendFileSync(join(import.meta.dirname, "..", "..", ".artifacts", "webgl.log"), `webgl-renderer ${test.info().project.name}: ${renderer ?? "none"}\n`);
  // CI sets E2E_REQUIRE_WEBGL so the Firefox render evidence cannot silently skip there; elsewhere a missing
  // environment is reported rather than passed or failed (conventions/frontend-testing.md).
  if (process.env.E2E_REQUIRE_WEBGL === "1") expect(renderer, "WebGL is required in this environment").not.toBeNull();
  test.skip(renderer === null, "WebGL is not available in this headless browser; the viewer render cannot be checked here");
  const asset = page.getByTestId("asset").filter({ hasText: "a wooden treasure chest" });
  const thumb = asset.getByRole("img");
  await expect(thumb).toHaveAttribute("src", /\/api\/assets\/[0-9a-f-]{36}\/thumb$/);
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await asset.getByRole("button", { name: /Preview/ }).click();
  // The viewer marks its element once model-viewer fires load; production logs nothing.
  await expect(page.locator("dialog[open] model-viewer")).toHaveAttribute("data-loaded", "true", { timeout: 60_000 });
  await expect.poll(() => renderedPixels(page), { timeout: 30_000 }).toBeGreaterThan(50);
  expect(consoleErrors).toEqual([]);
});

test("a failed viewer load shows an error and recovers through Reload viewer", async ({ page }) => {
  const s = shared();
  await signIn(page, s.url, s.token);
  await page.route(/\/assets\/viewer-[^/]+\.js$/, (route) => route.abort());
  await page.getByTestId("asset").first().getByRole("button", { name: /Preview/ }).click();
  await expect(page.getByText("The 3D viewer could not load.")).toBeVisible();
  await page.unroute(/\/assets\/viewer-[^/]+\.js$/);
  await page.getByRole("button", { name: "Reload viewer" }).click();
  await expect(page.locator("model-viewer")).toBeVisible({ timeout: 60_000 });
});

test("the empty profile shows the empty library @firefox", async ({ page }) => {
  const stack = await startStack("library-empty", "empty");
  try {
    await signIn(page, stack.url, stack.token);
    await expect(page.getByText("No assets yet")).toBeVisible();
    await expect(page.getByTestId("asset")).toHaveCount(0);
  } finally {
    await stack.stop();
  }
});
