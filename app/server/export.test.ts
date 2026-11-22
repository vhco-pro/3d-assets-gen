import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { solidPng, texturedGlb } from "../fake-comfy/assets.ts";
import { assetRoutes, slugFor } from "./export.ts";
import { createServer, type RunningServer } from "./http.ts";
import { authHeaders, testDirs, type TestDirs } from "./testkit.ts";

let dirs: TestDirs;
let srv: RunningServer;
const clock = { t: 1_800_000_000_000 };
beforeEach(() => {
  clock.t = 1_800_000_000_000;
  dirs = testDirs();
  srv = createServer(dirs.config, { tracker: false, now: () => clock.t, routes: assetRoutes(dirs.config, () => clock.t) });
});
afterEach(async () => {
  await srv.stop();
  dirs.cleanup();
});

interface Made {
  id: string;
  batch: string;
}
/** Inserts done jobs with asset files on disk. */
function doneJobs(items: { prompt?: string; upload?: string; engine?: "trellis" | "hunyuan" }[]): Made[] {
  const batch = crypto.randomUUID();
  const kind = items[0]?.upload ? "image" : "prompt";
  srv.store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, ?, '{}', ?, ?)", [batch, kind, batch, clock.t]);
  return items.map((item, position) => {
    const id = crypto.randomUUID();
    const engine = item.engine ?? "trellis";
    srv.store.db.run(
      `INSERT INTO jobs (id, batch_id, position, kind, prompt, upload_name, upload_ext, engine, faces, tex, style, seed, state, created_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10000, ?, 1, ?, 'done', ?, ?)`,
      [id, batch, position, kind, item.prompt ?? null, item.upload ?? null, item.upload ? "png" : null, engine, engine === "trellis" ? 2048 : null, 42 + position, clock.t, clock.t],
    );
    const dir = join(dirs.config.dataDir, "assets", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "model.glb"), texturedGlb());
    writeFileSync(join(dir, "source.png"), solidPng(16, 16, [1, 2, 3]));
    writeFileSync(join(dir, "thumb.png"), solidPng(4, 4, [1, 2, 3]));
    if (kind === "image") {
      mkdirSync(join(dirs.config.dataDir, "uploads", batch), { recursive: true });
      writeFileSync(join(dirs.config.dataDir, "uploads", batch, `${String(position)}.png`), "x");
    }
    return { id, batch };
  });
}

async function get(path: string, headers: Record<string, string> = authHeaders()): Promise<Response> {
  return fetch(srv.url + path, { headers, redirect: "manual" });
}

async function startExport(ids: string[]): Promise<Response> {
  return fetch(`${srv.url}/api/exports`, { method: "POST", headers: authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ jobs: ids }) });
}

/** Minimal zip reader: entry names and contents from the central directory. */
function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lName = view.getUint16(local + 26, true);
    const lExtra = view.getUint16(local + 28, true);
    const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    out.set(name, method === 8 ? new Uint8Array(inflateRawSync(data)) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe("slugs", () => {
  test("lowercase, runs of other characters become one dash, trimmed, 40 characters, empty becomes asset", () => {
    expect(slugFor("  A Wooden Crate!! (big) ")).toBe("a-wooden-crate-big");
    expect(slugFor("木箱")).toBe("asset");
    expect(slugFor("x".repeat(60))).toBe("x".repeat(40));
    expect(slugFor("chest_photo.final")).toBe("chest-photo-final");
  });
});

describe("single asset downloads", () => {
  test("the GLB downloads with a slug name and a glTF header; source and thumbnail are served", async () => {
    const [a] = doneJobs([{ prompt: "A Wooden Crate" }]);
    const res = await get(`/api/assets/${a?.id ?? ""}/model.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="a-wooden-crate-${(a?.id ?? "").slice(0, 8)}.glb"`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
    expect((await get(`/api/assets/${a?.id ?? ""}/source`)).headers.get("content-type")).toBe("image/png");
    expect((await get(`/api/assets/${a?.id ?? ""}/thumb`)).status).toBe(200);
  });

  test("an image job is named after its upload; a non-Latin prompt becomes asset", async () => {
    const [img] = doneJobs([{ upload: "Old Chest.webp" }]);
    expect((await get(`/api/assets/${img?.id ?? ""}/model.glb`)).headers.get("content-disposition")).toContain(`"old-chest-${(img?.id ?? "").slice(0, 8)}.glb"`);
    const [jp] = doneJobs([{ prompt: "木箱" }]);
    expect((await get(`/api/assets/${jp?.id ?? ""}/model.glb`)).headers.get("content-disposition")).toContain(`"asset-${(jp?.id ?? "").slice(0, 8)}.glb"`);
  });

  test("assets of unknown or unfinished jobs are 404", async () => {
    expect((await get(`/api/assets/${crypto.randomUUID()}/model.glb`)).status).toBe(404);
    expect((await get("/api/assets/not-a-uuid/model.glb")).status).toBe(404);
  });
});

describe("delete", () => {
  test("deleting a finished job removes its row, files, ComfyUI leftovers and, with the last job, its uploads", async () => {
    const [a, b] = doneJobs([{ upload: "a.png" }, { upload: "b.png" }]);
    mkdirSync(join(dirs.config.comfyOutputDir, a?.id ?? ""), { recursive: true });
    const del = await fetch(`${srv.url}/api/jobs/${a?.id ?? ""}`, { method: "DELETE", headers: authHeaders() });
    expect(del.status).toBe(204);
    expect((await get(`/api/jobs/${a?.id ?? ""}`)).status).toBe(404);
    expect(existsSync(join(dirs.config.dataDir, "assets", a?.id ?? ""))).toBe(false);
    expect(existsSync(join(dirs.config.comfyOutputDir, a?.id ?? ""))).toBe(false);
    expect(existsSync(join(dirs.config.dataDir, "uploads", a?.batch ?? ""))).toBe(true);
    await fetch(`${srv.url}/api/jobs/${b?.id ?? ""}`, { method: "DELETE", headers: authHeaders() });
    expect(existsSync(join(dirs.config.dataDir, "uploads", a?.batch ?? ""))).toBe(false);
  });

  test("an unfinished job cannot be deleted", async () => {
    const [a] = doneJobs([{ prompt: "x" }]);
    srv.store.db.run("UPDATE jobs SET state = 'pending' WHERE id = ?", [a?.id ?? ""]);
    expect((await fetch(`${srv.url}/api/jobs/${a?.id ?? ""}`, { method: "DELETE", headers: authHeaders() })).status).toBe(409);
  });
});

describe("zip export", () => {
  test("three assets export through a one-time link with slug names and the documented manifest", async () => {
    const made = doneJobs([{ prompt: "A crate" }, { prompt: "A sword" }, { prompt: "A stone pillar", engine: "hunyuan" }]);
    const res = await startExport(made.map((m) => m.id));
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^\/api\/exports\/[0-9a-f-]{36}$/);
    const zipRes = await get(url);
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    const files = unzip(new Uint8Array(await zipRes.arrayBuffer()));
    const short = made.map((m) => m.id.slice(0, 8));
    expect([...files.keys()].sort()).toEqual([
      `a-crate-${short[0] ?? ""}.glb`, `a-crate-${short[0] ?? ""}.png`, `a-stone-pillar-${short[2] ?? ""}.glb`,
      `a-stone-pillar-${short[2] ?? ""}.png`, `a-sword-${short[1] ?? ""}.glb`, `a-sword-${short[1] ?? ""}.png`, "manifest.json",
    ].sort());
    const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))) as { schema: number; assets: Record<string, unknown>[] };
    expect(manifest.schema).toBe(1);
    expect(manifest.assets).toHaveLength(3);
    expect(manifest.assets[2]).toEqual({
      id: made[2]?.id, glb: `a-stone-pillar-${short[2] ?? ""}.glb`, source: `a-stone-pillar-${short[2] ?? ""}.png`, prompt: "A stone pillar",
      upload: null, engine: "hunyuan", faces: 10000, texture: null, style: true, seed: 44, created: new Date(clock.t).toISOString(),
    });
    expect(new TextDecoder().decode(files.get(`a-crate-${short[0] ?? ""}.glb`)?.subarray(0, 4))).toBe("glTF");
    expect((await get(url)).status).toBe(404);
  });

  test("more than 100 assets, or more than 2 GiB, is refused with the split message", async () => {
    const many = doneJobs(Array.from({ length: 101 }, (_, i) => ({ prompt: `p${String(i)}` })));
    const res = await startExport(many.map((m) => m.id));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/split/);
    const big = doneJobs([{ prompt: "a" }, { prompt: "b" }]);
    for (const m of big) truncateSync(join(dirs.config.dataDir, "assets", m.id, "model.glb"), 1024 * 1024 * 1024 + 10);
    expect((await startExport(big.map((m) => m.id))).status).toBe(413);
  });

  test("links need credentials, expire after five minutes, and redirect when the selection changed", async () => {
    const made = doneJobs([{ prompt: "a" }, { prompt: "b" }]);
    const first = ((await (await startExport(made.map((m) => m.id))).json()) as { url: string }).url;
    expect((await get(first, {})).status).toBe(401);
    clock.t += 5 * 60_000 + 1000;
    expect((await get(first)).status).toBe(404);
    const second = ((await (await startExport(made.map((m) => m.id))).json()) as { url: string }).url;
    await fetch(`${srv.url}/api/jobs/${made[1]?.id ?? ""}`, { method: "DELETE", headers: authHeaders() });
    const res = await get(second);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?export=gone");
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  test("a selection with an unfinished or unknown job is refused", async () => {
    const [a] = doneJobs([{ prompt: "a" }]);
    expect((await startExport([a?.id ?? "", crypto.randomUUID()])).status).toBe(400);
    expect((await startExport([])).status).toBe(400);
  });
});
