import { readFileSync } from "node:fs";
import { expect, shared, signIn, test } from "./fixtures.ts";
import { unzip } from "./zip.ts";

test.beforeEach(async ({ page }) => {
  const s = shared();
  await signIn(page, s.url, s.token);
});

test("one asset downloads as a GLB named after its prompt @firefox", async ({ page }) => {
  const asset = page.getByTestId("asset").filter({ hasText: "a wooden treasure chest" });
  const [download] = await Promise.all([page.waitForEvent("download"), asset.getByRole("button", { name: /^Download/ }).click()]);
  expect(download.suggestedFilename()).toBe("a-wooden-treasure-chest-00000000.glb");
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 4).toString()).toBe("glTF");
  const jp = page.getByTestId("asset").filter({ hasText: "木箱" });
  const [second] = await Promise.all([page.waitForEvent("download"), jp.getByRole("button", { name: /^Download/ }).click()]);
  expect(second.suggestedFilename()).toBe("asset-00000000.glb");
});

test("three selected assets download as one zip with a manifest @firefox", async ({ page }) => {
  for (const name of ["a wooden treasure chest", "a rusty sci-fi pistol", "a stone pillar"]) {
    await page.getByTestId("asset").filter({ hasText: name }).getByRole("checkbox").check();
  }
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download selected" }).click()]);
  const files = unzip(readFileSync(await download.path()));
  expect([...files.keys()].sort()).toEqual([
    "a-rusty-sci-fi-pistol-00000000.glb", "a-rusty-sci-fi-pistol-00000000.png",
    "a-stone-pillar-00000000.glb", "a-stone-pillar-00000000.png",
    "a-wooden-treasure-chest-00000000.glb", "a-wooden-treasure-chest-00000000.png", "manifest.json",
  ]);
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as { schema: number; assets: { glb: string; engine: string; faces: number }[] };
  expect(manifest.schema).toBe(1);
  expect(manifest.assets.map((a) => a.glb).sort()).toEqual([...files.keys()].filter((k) => k.endsWith(".glb")).sort());
  const again = await page.request.get(download.url());
  expect(again.status()).toBe(404);
});
