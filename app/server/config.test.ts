import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "./config.ts";

const TOKEN = "ZGV2LXRva2VuLW5vdC1mb3ItcHJvZHVjdGlvbi0wMDA";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfg-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
function write(text: string): string {
  const p = join(dir, "config.yaml");
  writeFileSync(p, text);
  return p;
}

test("defaults fill everything but the token", () => {
  const c = loadConfig(write(`token: ${TOKEN}\n`));
  expect(c).toEqual({
    listen: "0.0.0.0:8790",
    comfyuiUrl: "http://host.docker.internal:8188",
    dataDir: "/data",
    comfyInputDir: "/comfy/input",
    comfyOutputDir: "/comfy/output",
    token: TOKEN,
    limits: { batchJobs: 25, batchImageBytes: 200 * 1024 * 1024, unfinishedJobs: 100 },
  });
});

test("every key can be set", () => {
  const c = loadConfig(write([
    "listen: 127.0.0.1:9000", "comfyui_url: http://127.0.0.1:8189", "data_dir: /tmp/d",
    "comfy_input_dir: /tmp/i", "comfy_output_dir: /tmp/o", `token: ${TOKEN}`,
    "limits:", "  batch_jobs: 5", "  batch_image_bytes: 1000", "  unfinished_jobs: 7", "",
  ].join("\n")));
  expect(c.listen).toBe("127.0.0.1:9000");
  expect(c.limits).toEqual({ batchJobs: 5, batchImageBytes: 1000, unfinishedJobs: 7 });
});

test("unknown keys, bad types and short tokens are refused", () => {
  expect(() => loadConfig(write(`token: ${TOKEN}\nextra: 1\n`))).toThrow(ConfigError);
  expect(() => loadConfig(write(`token: ${TOKEN}\nlimits:\n  batch_jobs: lots\n`))).toThrow(ConfigError);
  expect(() => loadConfig(write(`token: ${TOKEN}\nlimits:\n  other: 1\n`))).toThrow(ConfigError);
  expect(() => loadConfig(write("token: dev-token-not-for-production\n"))).toThrow(/43/);
  expect(() => loadConfig(write(`token: "${TOKEN.slice(0, 42)}"\n`))).toThrow(ConfigError);
  expect(() => loadConfig(write("listen: 1\n"))).toThrow(ConfigError);
});
