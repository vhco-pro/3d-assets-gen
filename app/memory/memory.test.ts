// Memory check of the built image under a 1 GiB limit: two concurrent 200 MiB image batches and a
// 100-asset export must not get the container killed, and its anonymous memory must stay below 512 MiB.
// Run by `bun run verify` after the image build: bun test ./app/memory
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solidPng, texturedGlb } from "../fake-comfy/assets.ts";
import { openStore } from "../server/store.ts";

const IMAGE = process.env.IMAGE ?? "asset-studio:local";
const TOKEN = "bWVtb3J5LWNoZWNrLXRva2VuLWZvci1hc3NldC1zdHVkaW8tY2k";
const MiB = 1024 * 1024;
const docker = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

let root: string;
let container: string;
let url: string;
let statPath: string;
let peakAnon = 0;
let sampler: ReturnType<typeof setInterval> | null = null;
const jobIds: string[] = [];

function anonBytes(): number {
  const m = /^anon (\d+)$/m.exec(readFileSync(statPath, "utf8"));
  return m ? Number(m[1]) : 0;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "memory-check-"));
  const data = join(root, "data");
  for (const d of [data, join(root, "in"), join(root, "out")]) {
    mkdirSync(d, { recursive: true });
    chmodSync(d, 0o777);
  }
  // 100 done assets with sparse 15 MiB GLBs, written before the container starts.
  const store = openStore(data);
  const batch = crypto.randomUUID();
  store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, 'prompt', '{}', ?, ?)", [batch, batch, Date.now()]);
  for (let i = 0; i < 100; i++) {
    const id = crypto.randomUUID();
    jobIds.push(id);
    store.db.run(`INSERT INTO jobs (id, batch_id, position, kind, prompt, engine, faces, tex, style, seed, state, created_at)
      VALUES (?, ?, ?, 'prompt', ?, 'trellis', 10000, 2048, 1, ?, 'done', ?)`, [id, batch, i, `memory asset ${String(i)}`, i, Date.now()]);
    const dir = join(data, "assets", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "model.glb"), texturedGlb());
    truncateSync(join(dir, "model.glb"), 15 * MiB);
    writeFileSync(join(dir, "source.png"), solidPng(8, 8, [1, 2, 3]));
    writeFileSync(join(dir, "thumb.png"), solidPng(4, 4, [1, 2, 3]));
  }
  store.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  store.close();
  new Database(join(data, "asset-studio.sqlite")).close();
  execFileSync("chmod", ["-R", "a+rwX", data]);
  writeFileSync(join(root, "config.yaml"), `token: ${TOKEN}\ncomfyui_url: http://127.0.0.1:1\n`);
  chmodSync(join(root, "config.yaml"), 0o644);
  container = `asset-studio-memory-${String(process.pid)}`;
  docker("run", "-d", "--name", container, "--memory", "1g", "--memory-swap", "1g", "--read-only", "--tmpfs", "/tmp", "-p", "127.0.0.1::8790",
    "-v", `${data}:/data`, "-v", `${join(root, "in")}:/comfy/input`, "-v", `${join(root, "out")}:/comfy/output`,
    "-v", `${join(root, "config.yaml")}:/config/config.yaml:ro`, IMAGE);
  url = `http://127.0.0.1:${docker("port", container, "8790/tcp").split(":").pop() ?? ""}`;
  // The container's cgroup on the host, from its main process (systemd: /sys/fs/cgroup/system.slice/docker-<id>.scope).
  const pid = docker("inspect", "-f", "{{.State.Pid}}", container);
  const cgroup = (readFileSync(`/proc/${pid}/cgroup`, "utf8").split("\n").find((l) => l.startsWith("0::")) ?? "").slice(3);
  statPath = join("/sys/fs/cgroup", cgroup, "memory.stat");
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // starting
    }
    await Bun.sleep(250);
  }
  sampler = setInterval(() => {
    try {
      peakAnon = Math.max(peakAnon, anonBytes());
    } catch {
      // container gone; the OOM check reports it
    }
  }, 100);
});

afterAll(() => {
  if (sampler) clearInterval(sampler);
  if (process.env.MEMORY_DEBUG) {
    console.log(docker("inspect", "-f", "{{.State.OOMKilled}} {{.State.Running}} {{.State.ExitCode}}", container));
    console.log(execFileSync("docker", ["logs", "--tail", "40", container], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  }
  try {
    docker("rm", "-f", container);
    execFileSync("docker", ["run", "--rm", "-v", `${root}:/cleanup`, "alpine:3.22", "sh", "-c", "rm -rf /cleanup/data"], { stdio: "ignore" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const auth = { authorization: `Bearer ${TOKEN}` };
const presets = { engine: "trellis", faces: 10000, tex: 2048, variants: 1, style: true, seed: null };
const eight = new Uint8Array(8 * MiB).fill(3);
eight.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function bigBatch(tag: string): Promise<number> {
  const form = new FormData();
  form.set("presets", JSON.stringify(presets));
  const blob = new Blob([eight], { type: "image/png" });
  for (let i = 0; i < 25; i++) form.append("images", blob, `${tag}-${String(i)}.png`);
  const res = await fetch(`${url}/api/batches`, { method: "POST", headers: { ...auth, "x-batch-id": crypto.randomUUID() }, body: form });
  return res.status;
}

test("a 200 MiB batch, two at once, and a 100-asset export stay inside the memory budget", async () => {
  expect(await bigBatch("one")).toBe(201);
  // Only 100 unfinished jobs are allowed; delete the first batch's jobs so the concurrent pair is accepted.
  const jobs = (await (await fetch(`${url}/api/jobs?state=pending`, { headers: auth })).json()) as { jobs: { id: string }[] };
  for (const j of jobs.jobs) await fetch(`${url}/api/jobs/${j.id}/cancel`, { method: "POST", headers: auth });
  expect((await Promise.all([bigBatch("two"), bigBatch("three")])).sort()).toEqual([201, 201]);
  const start = (await (await fetch(`${url}/api/exports`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jobs: jobIds }) })).json()) as { url: string };
  const res = await fetch(url + start.url, { headers: auth });
  expect(res.status).toBe(200);
  let bytes = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(100 * 15 * MiB);
  await Bun.sleep(300);
  expect(docker("inspect", "-f", "{{.State.OOMKilled}} {{.State.Running}}", container)).toBe("false true");
  expect(peakAnon).toBeGreaterThan(0);
  expect(peakAnon).toBeLessThan(512 * MiB);
  console.log(`› peak anonymous memory ${(peakAnon / MiB).toFixed(1)} MiB`);
}, 600_000);
