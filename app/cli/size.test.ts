import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSize } from "./size.ts";

let dist: string;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "size-"));
  mkdirSync(join(dist, "assets"));
  mkdirSync(join(dist, ".vite"));
  writeFileSync(join(dist, ".vite", "manifest.json"), JSON.stringify({ "index.html": { file: "assets/main.js", isEntry: true }, "viewer.ts": { file: "assets/viewer.js", isEntry: true } }));
  writeFileSync(join(dist, "assets", "viewer.js"), `export const v = ${JSON.stringify("x".repeat(1000))};`);
  writeFileSync(join(dist, "assets", "shared.js"), "export const s = 1;");
});
afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

function page(preload = ""): void {
  writeFileSync(join(dist, "index.html"), `<html><head>${preload}<script type="module" crossorigin src="/assets/main.js"></script></head></html>`);
}

test("a small build with a lazily loaded viewer passes", () => {
  page();
  writeFileSync(join(dist, "assets", "main.js"), 'import{s}from"./shared.js";const load=()=>import("./viewer.js");console.log(s,load);');
  const r = checkSize(dist);
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
});

test("a viewer imported statically by the entry fails", () => {
  page();
  writeFileSync(join(dist, "assets", "main.js"), 'import"./viewer.js";console.log(1);');
  expect(checkSize(dist).problems).toContain("the viewer is reachable from the initial load's static imports");
});

test("an entry over 150 KiB gzipped fails, counting modulepreload links", () => {
  page('<link rel="modulepreload" href="/assets/big.js">');
  writeFileSync(join(dist, "assets", "main.js"), "console.log(1);");
  writeFileSync(join(dist, "assets", "big.js"), `export const b = "${randomBytes(180 * 1024).toString("base64")}";`);
  const r = checkSize(dist);
  expect(r.ok).toBe(false);
  expect(r.problems.join(" ")).toMatch(/over 150 KiB/);
});
