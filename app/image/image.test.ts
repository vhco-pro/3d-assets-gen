// Start check of a built image (default asset-studio:local, or IMAGE=<ref>): non-root, read-only root
// filesystem, a fresh named volume at /data, and the page and health answering with the build identity.
// Run by `bun run verify` after the image build: bun test ./app/image
import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../server/store.ts";
import { join } from "node:path";

const IMAGE = process.env.IMAGE ?? "asset-studio:local";
const EXPECT_VERSION = process.env.EXPECT_VERSION;
const EXPECT_COMMIT = process.env.EXPECT_COMMIT;
const TOKEN = "aW1hZ2UtY2hlY2stdG9rZW4tZm9yLWFzc2V0LXN0dWRpby1jaQ";
const docker = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

let root: string;
let volume: string;
let container: string;
let url: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "image-check-"));
  for (const d of ["in", "out"]) {
    mkdirSync(join(root, d));
    chmodSync(join(root, d), 0o777);
  }
  writeFileSync(join(root, "config.yaml"), `token: ${TOKEN}\ncomfyui_url: http://127.0.0.1:1\n`);
  chmodSync(join(root, "config.yaml"), 0o644);
  volume = `asset-studio-check-${String(process.pid)}`;
  container = `asset-studio-check-${String(process.pid)}`;
  docker("volume", "create", volume);
  docker("run", "-d", "--name", container, "--read-only", "--tmpfs", "/tmp", "-p", "127.0.0.1::8790",
    "-v", `${volume}:/data`, "-v", `${join(root, "in")}:/comfy/input`, "-v", `${join(root, "out")}:/comfy/output`,
    "-v", `${join(root, "config.yaml")}:/config/config.yaml:ro`, IMAGE);
  const port = docker("port", container, "8790/tcp").split(":").pop() ?? "";
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return;
    } catch {
      // starting
    }
    await Bun.sleep(250);
  }
  throw new Error(`container did not answer: ${docker("logs", container)}`);
});

afterAll(() => {
  try {
    docker("rm", "-f", container);
    docker("volume", "rm", "-f", volume);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the server runs as UID 65532", () => {
  expect(docker("inspect", "-f", "{{.Config.User}}", container)).toBe("nonroot:nonroot");
  const uids = docker("top", container, "-eo", "pid,uid").split("\n").slice(1).map((s) => s.trim().split(/\s+/)[1] ?? "");
  expect(uids).toEqual(["65532"]);
});

test("the root filesystem is read-only: a write outside the declared paths fails", () => {
  expect(docker("inspect", "-f", "{{.HostConfig.ReadonlyRootfs}}", container)).toBe("true");
  writeFileSync(join(root, "probe.yaml"), `token: ${TOKEN}\ndata_dir: /not-writable\n`);
  chmodSync(join(root, "probe.yaml"), 0o644);
  let failed = false;
  try {
    execFileSync("docker", ["run", "--rm", "--read-only", "-v", `${join(root, "probe.yaml")}:/config/config.yaml:ro`, "-v", `${join(root, "config.yaml")}:/backup.sqlite:ro`, IMAGE,
      "restore-backup", "/backup.sqlite", "--config", "/config/config.yaml"], { stdio: "pipe" });
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
});

test("the database is created in the fresh /data volume, owned by the app", () => {
  const listing = execFileSync("docker", ["run", "--rm", "-v", `${volume}:/data:ro`, "--entrypoint", "/usr/local/bin/asset-studio", IMAGE, "schema-version"], { encoding: "utf8" }).trim();
  expect(listing).toBe(String(SCHEMA_VERSION));
  const owner = execFileSync("docker", ["run", "--rm", "-v", `${volume}:/data:ro`, "alpine:3.22", "stat", "-c", "%u %n", "/data/asset-studio.sqlite"], { encoding: "utf8" }).trim();
  expect(owner).toBe("65532 /data/asset-studio.sqlite");
});

test("the page and health answer with the build's version and commit", async () => {
  const page = await fetch(`${url}/`);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('<div id="root">');
  expect(html).toMatch(/<meta name="viewer-src" content="\/assets\/viewer-[^"]+\.js"/);
  const health = (await (await fetch(`${url}/api/health`)).json()) as { version: string; commit: string };
  if (EXPECT_VERSION) expect(health.version).toBe(EXPECT_VERSION);
  if (EXPECT_COMMIT) expect(health.commit).toBe(EXPECT_COMMIT);
  expect(health.version).not.toBe("dev");
});
