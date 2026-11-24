import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { solidPng, texturedGlb } from "../fake-comfy/assets.ts";
import { assetRoutes } from "./export.ts";
import { createServer, type RunningServer } from "./http.ts";
import { authHeaders, testDirs, type TestDirs } from "./testkit.ts";

let dirs: TestDirs;
let srv: RunningServer;
let logs: string[];
const clock = { t: 1_800_000_000_000 };

function start(token?: string): void {
  if (token) dirs.config.token = token;
  srv = createServer(dirs.config, { tracker: false, now: () => clock.t, routes: assetRoutes(dirs.config, () => clock.t), log: (line) => { logs.push(line); } });
}

beforeEach(() => {
  clock.t = 1_800_000_000_000;
  logs = [];
  dirs = testDirs();
  start();
});
afterEach(async () => {
  await srv.stop();
  dirs.cleanup();
});

function job(state: "done" | "failed"): string {
  const batch = crypto.randomUUID();
  const id = crypto.randomUUID();
  srv.store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, 'prompt', '{}', ?, ?)", [batch, batch, clock.t]);
  srv.store.db.run(
    `INSERT INTO jobs (id, batch_id, position, kind, prompt, engine, faces, tex, style, seed, state, created_at, finished_at)
     VALUES (?, ?, 0, 'prompt', 'a wooden chest', 'trellis', 10000, 2048, 1, 1, ?, ?, ?)`,
    [id, batch, state, clock.t, clock.t],
  );
  if (state === "done") {
    const dir = join(dirs.config.dataDir, "assets", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "model.glb"), texturedGlb());
    writeFileSync(join(dir, "source.png"), solidPng(4, 4, [1, 2, 3]));
    writeFileSync(join(dir, "thumb.png"), solidPng(4, 4, [1, 2, 3]));
  }
  return id;
}

async function arLink(id: string): Promise<string> {
  const res = await fetch(`${srv.url}/api/assets/${id}/ar-link`, { headers: authHeaders() });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string };
  expect(body.url).toMatch(new RegExp(`^/api/assets/${id}/model\\.glb\\?exp=\\d+&sig=[A-Za-z0-9_-]+$`));
  return body.url;
}

test("a link from ar-link fetches the GLB with no cookie, uncached, and logs one line", async () => {
  const id = job("done");
  const url = await arLink(id);
  expect(Number(new URL(url, srv.url).searchParams.get("exp"))).toBe(Math.floor(clock.t / 1000) + 15 * 60);
  const res = await fetch(`${srv.url}${url}`, { headers: { "user-agent": "SceneViewer-test/1.0" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("model/gltf-binary");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(texturedGlb()));
  const lines = logs.filter((l) => l.includes(id));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("SceneViewer-test/1.0");
  expect(lines[0]).toContain("127.0.0.1");
});

test("the link answers 401 once expired, with a changed signature, for another job and after a token change", async () => {
  const id = job("done");
  const other = job("done");
  const url = await arLink(id);
  const sig = new URL(url, srv.url).searchParams.get("sig") ?? "";
  const changed = url.replace(`sig=${sig}`, `sig=${(sig[0] === "A" ? "B" : "A") + sig.slice(1)}`);
  expect((await fetch(`${srv.url}${changed}`)).status).toBe(401);
  expect((await fetch(`${srv.url}${url.replace(id, other)}`)).status).toBe(401);
  clock.t += 15 * 60_000 + 1000;
  expect((await fetch(`${srv.url}${url}`)).status).toBe(401);
  clock.t -= 15 * 60_000 + 1000;
  expect((await fetch(`${srv.url}${url}`)).status).toBe(200);
  await srv.stop();
  start("cm90YXRlZC10b2tlbi1mb3ItYXNzZXQtc3R1ZGlvLXVuaXQtdGVzdA");
  expect((await fetch(`${srv.url}${url}`)).status).toBe(401);
});

test("a bad signature counts toward the per-client failure limit", async () => {
  const id = job("done");
  const url = `/api/assets/${id}/model.glb?exp=${String(Math.floor(clock.t / 1000) + 600)}&sig=AAAA`;
  for (let i = 0; i < 10; i++) expect((await fetch(`${srv.url}${url}`)).status).toBe(401);
  expect((await fetch(`${srv.url}${url}`)).status).toBe(429);
});

test("ar-link answers 404 for an unknown job and for one that is not done, and needs a session", async () => {
  const failed = job("failed");
  for (const id of [crypto.randomUUID(), failed]) {
    const res = await fetch(`${srv.url}/api/assets/${id}/ar-link`, { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such asset." });
  }
  expect((await fetch(`${srv.url}/api/assets/${job("done")}/ar-link`)).status).toBe(401);
});

test("model.glb without exp and sig still needs the session", async () => {
  const id = job("done");
  expect((await fetch(`${srv.url}/api/assets/${id}/model.glb`)).status).toBe(401);
  expect((await fetch(`${srv.url}/api/assets/${id}/model.glb`, { headers: authHeaders() })).status).toBe(200);
});
