import { expect, shared, signIn, test, uniquePrompt } from "./fixtures.ts";

const MiB = 1024 * 1024;
const png = (size: number, fill = 7): Buffer => {
  const b = Buffer.alloc(size, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
};

test.beforeEach(async ({ page }) => {
  const s = shared();
  await signIn(page, s.url, s.token);
});

test("three prompt lines with two variants add six jobs", async ({ page }) => {
  const base = uniquePrompt("submit");
  await page.getByLabel("Prompts").fill([`${base} crate`, `${base} sword`, `${base} lamp`].join("\n"));
  await page.getByLabel("Variants").fill("2");
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("status").filter({ hasText: "6 jobs added" })).toBeVisible();
  await expect(page.getByTestId("asset").filter({ hasText: base })).toHaveCount(6, { timeout: 60_000 });
});

test("an image batch adds one job per image @firefox", async ({ page }) => {
  await page.getByLabel("Images").setInputFiles([
    { name: `${uniquePrompt("img")}.png`, mimeType: "image/png", buffer: png(2048, 1) },
    { name: `${uniquePrompt("img")}.png`, mimeType: "image/png", buffer: png(2048, 2) },
  ]);
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 jobs added" })).toBeVisible();
});

test("invalid batches show the problem and add nothing", async ({ page }) => {
  const alert = page.getByRole("alert");
  const generate = page.getByRole("button", { name: "Generate" });
  await page.getByLabel("Prompts").fill("   \n  ");
  await generate.click();
  await expect(alert).toContainText("Add at least one prompt or image");
  await page.getByLabel("Prompts").fill("x".repeat(501));
  await generate.click();
  await expect(alert).toContainText("500 characters");
  await page.getByLabel("Prompts").fill(Array.from({ length: 13 }, (_, i) => `p${String(i)}`).join("\n"));
  await page.getByLabel("Variants").fill("2");
  await generate.click();
  await expect(alert).toContainText("25 jobs");
  await page.getByLabel("Variants").fill("1");
  await page.getByLabel("Prompts").fill("");
  await page.getByLabel("Images").setInputFiles([{ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a-not-allowed") }]);
  await generate.click();
  await expect(alert).toContainText("PNG, JPEG or WebP");
  await page.getByLabel("Images").setInputFiles([{ name: "huge.png", mimeType: "image/png", buffer: png(20 * MiB + 1) }]);
  await generate.click();
  await expect(alert).toContainText("20 MiB");
  await expect(page.getByRole("status").filter({ hasText: "jobs added" })).toHaveCount(0);
});
