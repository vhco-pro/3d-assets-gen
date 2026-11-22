// AC-25: the page's controls come from shadcn/ui components on Tailwind CSS v4, themed with VH Midnight.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const css = readFileSync(join(ROOT, "app/web/styles.css"), "utf8");

test("the shadcn components the page uses exist", () => {
  for (const c of ["button", "badge", "card", "dialog", "input", "textarea", "toggle-group", "switch", "checkbox", "progress", "collapsible"]) {
    expect(existsSync(join(ROOT, "app/web/components/ui", `${c}.tsx`)), c).toBe(true);
  }
});

test("Vite builds Tailwind CSS v4 through @tailwindcss/vite", () => {
  expect(readFileSync(join(ROOT, "vite.config.ts"), "utf8")).toContain("@tailwindcss/vite");
  expect(css).toContain('@import "tailwindcss"');
});

test("shadcn's theme variables map onto the vh- prefixed VH Midnight tokens", () => {
  for (const [name, token] of [["--foreground", "--vh-ink"], ["--card", "--vh-card"], ["--border", "--vh-card-line"], ["--ring", "--vh-accent"], ["--primary", "--vh-accent"], ["--accent", "--vh-control-bg-hover"]]) {
    expect(css, name).toMatch(new RegExp(`\\s${name}:\\s*var\\(${token}\\);`));
  }
  expect(css).toMatch(/\s--background:\s*var\(--vh-bg-0\);/);
  expect(css).toMatch(/--vh-accent:\s*#4f8cff;/);
  expect(css).toMatch(/--vh-ok:\s*#34d39c;/);
});
