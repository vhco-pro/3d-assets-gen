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
  await page.getByLabel("Variants", { exact: true }).fill("2");
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "6 jobs added" })).toBeVisible();
  await expect(page.getByTestId("asset").filter({ hasText: base })).toHaveCount(6, { timeout: 60_000 });
});

test("an image batch adds one job per image @firefox", async ({ page }) => {
  await page.getByLabel("Images").setInputFiles([
    { name: `${uniquePrompt("img")}.png`, mimeType: "image/png", buffer: png(2048, 1) },
    { name: `${uniquePrompt("img")}.png`, mimeType: "image/png", buffer: png(2048, 2) },
  ]);
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 jobs added" })).toBeVisible();
});

test("an empty form keeps Generate disabled, reading Generate", async ({ page }) => {
  await page.getByLabel("Prompts").fill("   \n  ");
  const generate = page.getByRole("button", { name: /^Generate/ });
  await expect(generate).toHaveText("Generate");
  await expect(generate).toBeDisabled();
});

test("with prompts and images both present, images win and the composer says so", async ({ page }) => {
  await page.getByLabel("Prompts").fill("ignored prompt one\nignored prompt two");
  await page.getByLabel("Images").setInputFiles([
    { name: `${uniquePrompt("both")}.png`, mimeType: "image/png", buffer: png(2048, 3) },
  ]);
  await expect(page.getByText("Images are added; the prompts above are ignored.")).toBeVisible();
  const generate = page.getByRole("button", { name: /^Generate/ });
  await expect(generate).toHaveText("Generate 1 job");
  await generate.click();
  await expect(page.getByRole("status").filter({ hasText: "1 job added" })).toBeVisible();
});

test("invalid batches show the problem and add nothing", async ({ page }) => {
  const alert = page.getByRole("alert");
  const generate = page.getByRole("button", { name: /^Generate/ });
  // 2000 UTF-16 code units are allowed; one more is refused, counted the way the server counts.
  await page.getByLabel("Prompts").fill("x".repeat(2001));
  await generate.click();
  await expect(alert).toContainText("2000 characters");
  await page.getByLabel("Prompts").fill(Array.from({ length: 13 }, (_, i) => `p${String(i)}`).join("\n"));
  await page.getByLabel("Variants", { exact: true }).fill("2");
  await generate.click();
  await expect(alert).toContainText("25 jobs");
  await page.getByLabel("Variants", { exact: true }).fill("1");
  await page.getByLabel("Prompts").fill("");
  await page.getByLabel("Images").setInputFiles([{ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a-not-allowed") }]);
  await generate.click();
  await expect(alert).toContainText("PNG, JPEG or WebP");
  await page.getByLabel("Images").setInputFiles([{ name: "huge.png", mimeType: "image/png", buffer: png(20 * MiB + 1) }]);
  await generate.click();
  await expect(alert).toContainText("20 MiB");
  await expect(page.getByRole("status").filter({ hasText: "jobs added" })).toHaveCount(0);
});

test("Shared style is prefilled, saved on change, resettable, capped at 300 and off for images (AC-28)", async ({ page }) => {
  const field = page.getByLabel("Shared style", { exact: true });
  await page.evaluate(() => { localStorage.removeItem("asset-studio:shared-style"); });
  await page.reload();
  await expect(field).toHaveValue("stylized hand-painted game art, clean readable silhouette, consistent muted color palette");
  await field.fill("low-poly, flat shaded");
  await page.reload();
  await expect(page.getByLabel("Shared style", { exact: true })).toHaveValue("low-poly, flat shaded");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(field).toHaveValue("stylized hand-painted game art, clean readable silhouette, consistent muted color palette");
  await page.reload();
  await expect(field).toHaveValue("stylized hand-painted game art, clean readable silhouette, consistent muted color palette");
  await field.fill("s".repeat(320));
  expect((await field.inputValue()).length).toBe(300);
  await page.getByLabel("Images").setInputFiles([{ name: `${uniquePrompt("shared")}.png`, mimeType: "image/png", buffer: png(2048, 4) }]);
  await expect(field).toBeDisabled();
  await expect(page.getByText("Shared style applies to prompts only.")).toBeVisible();
});
