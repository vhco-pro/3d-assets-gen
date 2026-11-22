// The README and AGENTS.md name the commands, readiness, dependencies and the owner's checklist, and every
// command they name exists.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (f: string): string => readFileSync(join(ROOT, f), "utf8");
const readme = read("README.md");
const agents = read("AGENTS.md");
const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
const COMMANDS = ["bun run bootstrap", "bun run dev", "bun run seed", "bun run verify", "scripts/deploy/deploy.sh", "scripts/deploy/rollback.sh", "bun run clean"];

describe.each([["README.md", readme], ["AGENTS.md", agents]])("%s", (_name, text) => {
  test("names the seven commands", () => {
    for (const c of COMMANDS) expect(text).toContain(c);
  });
  test("every named bun run script and script path exists", () => {
    for (const m of text.matchAll(/bun run ([a-z:]+)/g)) expect(Object.keys(scripts)).toContain(m[1] ?? "");
    for (const m of text.matchAll(/(scripts\/[\w./-]+\.(?:sh|py))/g)) expect(existsSync(join(ROOT, m[1] ?? ""))).toBe(true);
  });
});

test("the README states the dependencies, the readiness signal and the owner's checklist", () => {
  for (const dep of ["Bun", "Docker", "python3"]) expect(readme).toContain(dep);
  expect(readme).toContain("✓ Passed: ready at");
  expect(readme).toMatch(/Share the `win-main` node/);
  expect(readme).toMatch(/`autogroup:shared` to port 443/);
});

test("AGENTS.md routes to the terminal output standard and no longer says no commands exist", () => {
  expect(agents).toContain("conventions/terminal-output.md");
  expect(agents).not.toContain("No build or test commands exist yet");
});

test("the README names TRELLIS.2 as the only mesh model and offers no engine choice (AC-23)", () => {
  expect(readme).toContain("TRELLIS.2");
  expect(readme).not.toMatch(/hunyuan/i);
  expect(readme).not.toMatch(/pick an engine|choose an engine|engine choice/i);
});
