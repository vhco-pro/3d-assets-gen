import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type RunningServer } from "./http.ts";
import { authHeaders, imageBytes, testDirs, type TestDirs } from "./testkit.ts";

const MiB = 1024 * 1024;
let dirs: TestDirs;
let srv: RunningServer;
beforeEach(() => {
  dirs = testDirs();
  srv = createServer(dirs.config, { tracker: false });
});
afterEach(async () => {
  await srv.stop();
  dirs.cleanup();
});

const presets = { faces: 10000, tex: 2048, variants: 1, style: true, seed: null };

async function postPrompts(prompts: string[], extra: Record<string, unknown> = {}, id: string = crypto.randomUUID()): Promise<Response> {
  return fetch(`${srv.url}/api/batches`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json", "x-batch-id": id }),
    body: JSON.stringify({ kind: "prompt", prompts, presets: { ...presets, ...extra } }),
  });
}

async function postImages(files: { name: string; bytes: Uint8Array | Blob }[], id: string = crypto.randomUUID()): Promise<Response> {
  const form = new FormData();
  form.set("presets", JSON.stringify(presets));
  for (const f of files) form.append("images", f.bytes instanceof Blob ? f.bytes : new Blob([f.bytes]), f.name);
  return fetch(`${srv.url}/api/batches`, { method: "POST", headers: authHeaders({ "x-batch-id": id }), body: form });
}

function jobCount(): number {
  return (srv.store.db.query("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n;
}
function treeEmpty(sub: string): boolean {
  const p = join(dirs.config.dataDir, sub);
  return !existsSync(p) || readdirSync(p).length === 0;
}
async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

describe("creating batches", () => {
  test("three prompt lines with two variants make six pending jobs in order", async () => {
    const res = await postPrompts(["a crate", "a sword", "a lamp"], { variants: 2 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { batch: { jobs: { state: string; position: number; prompt: string }[] } };
    expect(body.batch.jobs.map((j) => [j.position, j.prompt, j.state])).toEqual([
      [0, "a crate", "pending"], [1, "a crate", "pending"], [2, "a sword", "pending"],
      [3, "a sword", "pending"], [4, "a lamp", "pending"], [5, "a lamp", "pending"],
    ]);
    expect(jobCount()).toBe(6);
  });

  test("empty lines are dropped and prompts are trimmed", async () => {
    const res = await postPrompts(["  a crate  ", "", "   "]);
    expect(res.status).toBe(201);
    expect(jobCount()).toBe(1);
  });

  test("an image batch makes one job per image and keeps the files", async () => {
    const id = crypto.randomUUID();
    const res = await postImages([{ name: "chest.png", bytes: imageBytes("png") }, { name: "lamp.webp", bytes: imageBytes("webp") }], id);
    expect(res.status).toBe(201);
    expect(jobCount()).toBe(2);
    expect(readdirSync(join(dirs.config.dataDir, "uploads", id)).length).toBe(2);
    expect(treeEmpty("staging")).toBe(true);
  });
});

describe("TRELLIS.2 is the only engine (AC-23)", () => {
  test("a batch without an engine field, or with engine trellis, is accepted as TRELLIS.2", async () => {
    expect((await postPrompts(["a crate"])).status).toBe(201);
    expect((await postPrompts(["a lamp"], { engine: "trellis" })).status).toBe(201);
    const engines = srv.store.db.query("SELECT DISTINCT engine FROM jobs").all() as { engine: string }[];
    expect(engines).toEqual([{ engine: "trellis" }]);
  });
  test("a 2000-character prompt is accepted", async () => {
    expect((await postPrompts(["y".repeat(2000)])).status).toBe(201);
  });
});

describe("rejections create nothing and name the problem", () => {
  const cases: [string, () => Promise<Response>, number, RegExp][] = [
    ["empty batch", () => postPrompts(["", " "]), 400, /prompt/i],
    ["over-long prompt", () => postPrompts(["x".repeat(2001)]), 400, /2000 characters/],
    ["a Hunyuan3D engine", () => postPrompts(["a"], { engine: "hunyuan" }), 400, /^Hunyuan3D is no longer available; use TRELLIS\.2\.$/],
    ["an unknown engine", () => postPrompts(["a"], { engine: "x" }), 400, /Hunyuan3D is no longer available/],
    ["a missing texture", () => postPrompts(["a"], { tex: null }), 400, /texture/],
    ["more than 25 jobs", () => postPrompts(Array.from({ length: 13 }, (_, i) => `p${i}`), { variants: 2 }), 400, /25 jobs/],
    ["bad variants", () => postPrompts(["a"], { variants: 5 }), 400, /variants/i],
    ["wrong file type", () => postImages([{ name: "x.gif", bytes: imageBytes("gif") }]), 400, /PNG, JPEG or WebP/],
    ["oversized file", () => postImages([{ name: "big.png", bytes: imageBytes("png", 20 * MiB + 1) }]), 400, /20 MiB/],
  ];
  for (const [name, send, status, message] of cases) {
    test(name, async () => {
      const res = await send();
      expect(res.status).toBe(status);
      expect(await errorOf(res)).toMatch(message);
      expect(jobCount()).toBe(0);
      expect(treeEmpty("staging")).toBe(true);
      expect(treeEmpty("uploads")).toBe(true);
    });
  }

  test("a malformed batch ID is refused before anything is read or written", async () => {
    const res = await postPrompts(["a"], {}, "../x");
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatch(/batch ID/);
    expect(existsSync(join(dirs.config.dataDir, "staging"))).toBe(false);
  });

  test("a JSON batch over 1 MiB gets 413 with the app's message", async () => {
    const res = await postPrompts(["a".repeat(MiB + 10)]);
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toMatch(/1 MiB/);
  });

  test("more than 100 unfinished jobs is refused", async () => {
    for (let i = 0; i < 4; i++) expect((await postPrompts(Array.from({ length: 25 }, (_, k) => `p${i}-${k}`))).status).toBe(201);
    const res = await postPrompts(["one more"]);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatch(/100 unfinished jobs/);
    expect(jobCount()).toBe(100);
  });
});

describe("image size cap", () => {
  test("25 images with exactly 200 MiB are accepted, 200 MiB plus one byte is refused with 413", async () => {
    const eight = imageBytes("png", 8 * MiB);
    const ok = await postImages(Array.from({ length: 25 }, (_, i) => ({ name: `i${i}.png`, bytes: eight })));
    expect(ok.status).toBe(201);
    const over = Array.from({ length: 24 }, (_, i) => ({ name: `o${i}.png`, bytes: eight }));
    over.push({ name: "last.png", bytes: imageBytes("png", 8 * MiB + 1) });
    const res = await postImages(over);
    expect(res.status).toBe(413);
    expect(await errorOf(res)).toMatch(/200 MiB/);
    expect(jobCount()).toBe(25);
    expect(treeEmpty("staging")).toBe(true);
  }, 60_000);
});

describe("concurrency and idempotency", () => {
  test("two concurrent batches that together exceed 100 unfinished jobs: exactly one is accepted", async () => {
    for (let i = 0; i < 3; i++) await postPrompts(Array.from({ length: 25 }, (_, k) => `p${i}-${k}`));
    await postPrompts(Array.from({ length: 20 }, (_, k) => `q${k}`));
    const [a, b] = await Promise.all([postPrompts(["a", "b", "c"]), postPrompts(["d", "e", "f"])]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(jobCount()).toBe(98);
  });

  test("a repeated image batch with a new multipart boundary returns the existing batch and keeps its files", async () => {
    const id = crypto.randomUUID();
    const files = [{ name: "a.png", bytes: imageBytes("png", 2048, 1) }];
    expect((await postImages(files, id)).status).toBe(201);
    const before = readFileSync(join(dirs.config.dataDir, "uploads", id, readdirSync(join(dirs.config.dataDir, "uploads", id))[0] ?? ""));
    const again = await postImages(files, id);
    expect(again.status).toBe(200);
    const after = readFileSync(join(dirs.config.dataDir, "uploads", id, readdirSync(join(dirs.config.dataDir, "uploads", id))[0] ?? ""));
    expect(Buffer.compare(before, after)).toBe(0);
    expect(jobCount()).toBe(1);
    expect(treeEmpty("staging")).toBe(true);
  });

  test("two concurrent requests with the same image batch ID: one creates, one returns it", async () => {
    const id = crypto.randomUUID();
    const files = [{ name: "a.png", bytes: imageBytes("png", 4096, 2) }];
    const [a, b] = await Promise.all([postImages(files, id), postImages(files, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(jobCount()).toBe(1);
    expect(readdirSync(join(dirs.config.dataDir, "uploads", id)).length).toBe(1);
  });

  test("a reused ID with different content is a conflict and leaves the first batch intact", async () => {
    const id = crypto.randomUUID();
    expect((await postImages([{ name: "a.png", bytes: imageBytes("png", 2048, 1) }], id)).status).toBe(201);
    expect((await postImages([{ name: "a.png", bytes: imageBytes("png", 2048, 9) }], id)).status).toBe(409);
    expect((await postImages([{ name: "b.png", bytes: imageBytes("png", 2048, 1) }], id)).status).toBe(409);
    expect(readdirSync(join(dirs.config.dataDir, "uploads", id)).length).toBe(1);
    expect(jobCount()).toBe(1);
  });

  test("a reused prompt batch ID with the same content returns 200 and creates nothing", async () => {
    const id = crypto.randomUUID();
    expect((await postPrompts(["a"], {}, id)).status).toBe(201);
    expect((await postPrompts(["a"], {}, id)).status).toBe(200);
    expect((await postPrompts(["b"], {}, id)).status).toBe(409);
    expect(jobCount()).toBe(1);
  });
});
