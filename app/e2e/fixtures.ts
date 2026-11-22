// Shared helpers for the specs: the shared stack, sign-in, and console error collection.
import { expect, test as base, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SHARED_FILE } from "./harness.ts";

export interface SharedStack {
  url: string;
  token: string;
  root: string;
  fakeUrl: string;
}

export async function fakeControl(fakeUrl: string, action: string, value?: string): Promise<void> {
  const res = await fetch(`${fakeUrl}/_control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, value }) });
  if (!res.ok) throw new Error(`fake control ${action} failed`);
}

export function shared(): SharedStack {
  return JSON.parse(readFileSync(SHARED_FILE, "utf8")) as SharedStack;
}

export async function signIn(page: Page, url: string, token: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
}

/** Fails the test on any console error or page error. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));
      await use(errors);
    },
    { auto: true },
  ],
});

export { expect };

/** A fresh prompt that no other test uses, so mutating tests only touch their own jobs. */
export function uniquePrompt(label: string): string {
  return `${label} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Opens every collapsed batch group in the queue, so finished batches show their rows. */
export async function expandBatches(page: Page): Promise<void> {
  // The queue renders after the first job list arrives; count groups only once it is there.
  await expect(page.getByTestId("batch").first()).toBeVisible();
  const collapsed = page.getByRole("button", { name: "Expand batch" });
  for (let i = await collapsed.count(); i > 0; i--) {
    await collapsed.first().click();
  }
}
