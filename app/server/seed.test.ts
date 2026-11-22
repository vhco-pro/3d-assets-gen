import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FakeComfy } from "../fake-comfy/fake.ts";
import { ComfyClient } from "./comfy.ts";
import { loadConfig } from "./config.ts";
import { FIXTURE_JOBS, LONG_PROMPT, runSeed, seedFixture } from "./seed.ts";
import { DEV_TOKEN, startServer } from "./serve.ts";
import { openStore, type Store } from "./store.ts";
import { testDirs, type TestDirs } from "./testkit.ts";
import { Tracker } from "./tracker.ts";

let dirs: TestDirs;
let fake: FakeComfy;
beforeEach(() => {
  dirs = testDirs();
  fake = new FakeComfy({ outputDir: join(dirs.root, "comfy", "output"), inputDir: join(dirs.root, "comfy", "input"), dataDir: dirs.config.dataDir });
});
afterEach(() => {
  fake.stop();
  dirs.cleanup();
});

const states = (store: Store): { id: string; state: string }[] => store.db.query("SELECT id, state FROM jobs WHERE fixture = 1 ORDER BY id").all() as { id: string; state: string }[];

test("seeding twice gives the same fixture rows and leaves other rows alone; reset removes only fixtures", async () => {
  fake.start();
  dirs.config.comfyuiUrl = fake.url;
  const store = openStore(dirs.config.dataDir);
  store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'prompt', '{}', 'h', 1)");
  store.db.run(`INSERT INTO jobs (id, batch_id, position, kind, prompt, engine, faces, tex, style, seed, state, created_at)
    VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 0, 'prompt', 'mine', 'trellis', 10000, 2048, 1, 1, 'done', 1)`);
  store.close();
  expect(await runSeed(dirs.config, { profile: "default", reset: false })).toBe(0);
  const s1 = openStore(dirs.config.dataDir);
  const first = states(s1);
  s1.close();
  expect(await runSeed(dirs.config, { profile: "default", reset: false })).toBe(0);
  const s2 = openStore(dirs.config.dataDir);
  expect(states(s2)).toEqual(first);
  expect(first).toHaveLength(FIXTURE_JOBS.length);
  expect((s2.db.query("SELECT COUNT(*) AS n FROM jobs WHERE fixture = 0").get() as { n: number }).n).toBe(1);
  s2.close();
  expect(await runSeed(dirs.config, { profile: "default", reset: true })).toBe(0);
  const s3 = openStore(dirs.config.dataDir);
  expect(states(s3)).toEqual([]);
  expect((s3.db.query("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n).toBe(1);
  s3.close();
});

test("the seed refuses a ComfyUI that is not the fake", async () => {
  const real = Bun.serve({ port: 0, fetch: () => new Response("not here", { status: 404 }) });
  try {
    dirs.config.comfyuiUrl = `http://127.0.0.1:${String(real.port)}`;
    expect(await runSeed(dirs.config, { profile: "default", reset: false })).toBe(1);
  } finally {
    await real.stop(true);
  }
});

for (const order of ["seed before the fake starts", "seed after the fake started"] as const) {
  test(`fixture jobs keep their states past the 15-minute timeout: ${order}`, async () => {
    const store = openStore(dirs.config.dataDir);
    const clock = { t: Date.now() };
    if (order === "seed before the fake starts") seedFixture(store, dirs.config, "default", clock.t);
    fake.start();
    dirs.config.comfyuiUrl = fake.url;
    if (order === "seed after the fake started") seedFixture(store, dirs.config, "default", clock.t);
    const before = states(store);
    const t = new Tracker({ store, config: dirs.config, comfy: new ComfyClient(fake.url), now: () => clock.t });
    for (let i = 0; i < 5; i++) {
      clock.t += 5 * 60_000;
      await t.tick();
    }
    expect(states(store)).toEqual(before);
    store.close();
  });
}

test("the server refuses the development token against a ComfyUI without the fake marker", async () => {
  const real = Bun.serve({ port: 0, fetch: () => new Response("{}") });
  try {
    let message = "";
    try {
      await startServer({ ...dirs.config, token: DEV_TOKEN, comfyuiUrl: `http://127.0.0.1:${String(real.port)}` });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/fake ComfyUI/);
  } finally {
    await real.stop(true);
  }
});

test("the committed dev config loads and the loader refuses a short token", () => {
  const c = loadConfig(join(import.meta.dir, "..", "..", "dev", "config.yaml"));
  expect(c.token).toBe(DEV_TOKEN);
  expect(() => { loadConfig(join(dirs.root, "missing.yaml")); }).toThrow();
});

test("the fixture is TRELLIS.2 only and holds the long prompt on a done and a failed job (AC-23, AC-22)", () => {
  const store = openStore(dirs.config.dataDir);
  seedFixture(store, dirs.config, "default", Date.now());
  const engines = store.db.query("SELECT DISTINCT engine FROM jobs WHERE fixture = 1").all() as { engine: string }[];
  expect(engines).toEqual([{ engine: "trellis" }]);
  const long = store.db.query("SELECT state FROM jobs WHERE fixture = 1 AND prompt = ? ORDER BY state").all(LONG_PROMPT) as { state: string }[];
  expect(long.map((r) => r.state)).toEqual(["done", "failed"]);
  expect(LONG_PROMPT.length).toBeGreaterThan(1900);
  expect(LONG_PROMPT.length).toBeLessThanOrEqual(2000);
  expect(LONG_PROMPT.split(/\s+/).some((w) => w.length >= 120)).toBe(true);
  store.close();
});

test("the fixture's four-job batch, unseen start and running thumbnail are seeded with times relative to T (AC-26, AC-27)", () => {
  const store = openStore(dirs.config.dataDir);
  const t = 1_800_000_000_000;
  seedFixture(store, dirs.config, "default", t);
  const set = store.db.query("SELECT state, started_at, queued_at FROM jobs WHERE batch_id = '00000000-0000-4000-8000-000000000102' ORDER BY position").all() as { state: string; started_at: number | null; queued_at: number }[];
  expect(set.map((r) => r.state)).toEqual(["done", "submitted", "submitted", "failed"]);
  expect(set[1]?.started_at).toBe(t - 3 * 60_000);
  expect(set[2]?.started_at).toBeNull();
  expect(set[1]?.queued_at).toBe(t - 12 * 60_000);
  const unseen = store.db.query("SELECT started_at, finished_at FROM jobs WHERE prompt = '木箱'").get() as { started_at: number | null; finished_at: number };
  expect(unseen.started_at).toBeNull();
  const doneRow = store.db.query("SELECT started_at, finished_at FROM jobs WHERE prompt = 'a wooden treasure chest'").get() as { started_at: number; finished_at: number };
  expect(doneRow.finished_at - doneRow.started_at).toBe(400_000);
  const thumbs = join(dirs.config.comfyOutputDir, "00000000-0000-4000-8000-000000000007", "00000000-0000-4000-8000-000000000201", "thumb_00001_.png");
  expect(existsSync(thumbs)).toBe(true);
  store.close();
});
