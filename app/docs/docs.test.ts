// The README and AGENTS.md name the commands, readiness, dependencies and the owner's checklist, and every
// command they name exists.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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

test("the README records the security analysis coverage per language (AC-24)", () => {
  const section = readme.slice(readme.indexOf("## Security analysis"));
  expect(section.length).toBeGreaterThan(20);
  for (const language of ["JavaScript", "TypeScript", "Python", "Actions", "Bash", "PowerShell"]) expect(section).toContain(language);
});

// AC-11: nothing in the repository submits generations to a deployed app.
// A line naming /api/batches counts as a submission when an HTTP client call sits on it or within three
// lines of it, so a URL built just before the call is caught too; plain mentions pass.
const HTTP_CLIENT = /\bfetch\s*\(|\bcurl\b|\bwget\b|\burllib\b|\brequests\.|\bhttp\.client\b|XMLHttpRequest|Invoke-WebRequest|Invoke-RestMethod/i;
const NEAR = 3;
export function submitsBatches(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((line, i) => line.includes("/api/batches") && lines.slice(Math.max(0, i - NEAR), i + NEAR + 1).some((l) => HTTP_CLIENT.test(l)));
}

describe("no live generation check (AC-11)", () => {
  test("the pattern catches live submissions and passes plain mentions", () => {
    expect(submitsBatches("const res = await fetch(`${base}/api/batches`, { method: \"POST\" });")).toBe(true);
    expect(submitsBatches("curl -X POST https://win-main.example.ts.net/api/batches -d @b.json")).toBe(true);
    expect(submitsBatches("| `POST /api/batches` | Create a batch from prompts (JSON) or images (multipart) |")).toBe(false);
    expect(submitsBatches("The page posts a new batch to /api/batches.")).toBe(false);
    // R-22 F-05: other clients, and a URL built on the line before the call.
    expect(submitsBatches('req = urllib.request.Request(base + "/api/batches", data=body, method="POST")')).toBe(true);
    expect(submitsBatches("Invoke-RestMethod -Method Post -Uri https://win-main.example.ts.net/api/batches -Body $b")).toBe(true);
    expect(submitsBatches("wget --post-file=b.json https://win-main.example.ts.net/api/batches")).toBe(true);
    expect(submitsBatches("const url = `${base}/api/batches`;\nawait fetch(url, { method: \"POST\", body });")).toBe(true);
  });
  test("the live check, its script and its documentation are gone", () => {
    expect(existsSync(join(ROOT, "app/cli/verify-live.ts"))).toBe(false);
    expect(Object.keys(scripts)).not.toContain("verify:live");
    expect(Object.values(scripts).filter((s) => s.includes("https://"))).toEqual([]);
    expect(readme).not.toContain("verify:live");
    expect(agents).not.toContain("verify:live");
  });
  test("no tracked file outside the app's own server, page and local tests submits a batch", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: ROOT }).toString().split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs|sh|ps1|py)$/.test(f))
      .filter((f) => !/^app\/(server|web|e2e|memory|docs)\//.test(f));
    expect(files.filter((f) => submitsBatches(read(f)))).toEqual([]);
  });
});
