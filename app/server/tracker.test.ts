import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { combineGraph } from "../pipeline/combine.ts";
import { FakeComfy } from "../fake-comfy/fake.ts";
import { ComfyClient } from "./comfy.ts";
import { createBatch } from "./batches.ts";
import { solidPng } from "../fake-comfy/assets.ts";
import { getJob, requestCancel, retryJob, type JobRow } from "./jobs.ts";
import { readFileSync } from "node:fs";
import { openStore, type Store } from "./store.ts";
import { testDirs, type TestDirs } from "./testkit.ts";
import { Tracker, type Faults } from "./tracker.ts";

let dirs: TestDirs;
let fake: FakeComfy;
let store: Store;
const clock = { t: 1_800_000_000_000 };

beforeEach(() => {
  dirs = testDirs();
  fake = new FakeComfy({ outputDir: join(dirs.root, "comfy", "output"), inputDir: join(dirs.root, "comfy", "input"), runMs: 30 });
  fake.start();
  dirs.config.comfyuiUrl = fake.url;
  store = openStore(dirs.config.dataDir);
  clock.t = 1_800_000_000_000;
});
afterEach(() => {
  fake.stop();
  store.close();
  dirs.cleanup();
});

function tracker(opts: { timeoutMs?: number; faults?: Faults } = {}): Tracker {
  return new Tracker({
    store,
    config: dirs.config,
    comfy: new ComfyClient(dirs.config.comfyuiUrl, { timeoutMs: opts.timeoutMs ?? 10_000 }),
    now: () => clock.t,
    ...(opts.faults ? { faults: opts.faults } : {}),
  });
}

let batchSeq = 0;
/** Inserts a batch of prompt jobs (or image jobs with small PNG uploads) directly; returns job IDs in order. */
function addBatch(items: string[], opts: { kind?: "prompt" | "image"; engine?: "trellis" | "hunyuan"; fixture?: boolean } = {}): string[] {
  const kind = opts.kind ?? "prompt";
  const batch = crypto.randomUUID();
  const created = clock.t + batchSeq++;
  store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, ?, '{}', ?, ?)", [batch, kind, batch, created]);
  const ids: string[] = [];
  items.forEach((item, position) => {
    const id = crypto.randomUUID();
    ids.push(id);
    if (kind === "image") {
      const dir = join(dirs.config.dataDir, "uploads", batch);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${String(position)}.png`), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
    }
    store.db.run(
      `INSERT INTO jobs (id, batch_id, position, kind, prompt, upload_name, upload_ext, engine, faces, tex, style, seed, state, fixture, created_at, queued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10000, ?, 1, ?, 'pending', ?, ?, ?)`,
      [id, batch, position, kind, kind === "prompt" ? item : null, kind === "image" ? item : null, kind === "image" ? "png" : null,
        opts.engine ?? "trellis", (opts.engine ?? "trellis") === "trellis" ? 2048 : null, 1000 + position, opts.fixture ? 1 : 0, created, created],
    );
  });
  return ids;
}

function job(id: string): JobRow {
  const j = getJob(store, id);
  if (!j) throw new Error(`no job ${id}`);
  return j;
}

/** Ticks (advancing the clock 2 s each time) until `done` holds or `max` ticks pass. */
async function runUntil(t: Tracker, done: () => boolean, max = 200): Promise<void> {
  for (let i = 0; i < max; i++) {
    await t.tick();
    if (done()) return;
    clock.t += 2000;
    await Bun.sleep(15);
  }
  throw new Error("condition not reached");
}

const assetFiles = (id: string): string[] => {
  const dir = join(dirs.config.dataDir, "assets", id);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const promptBodies = (): { prompt: Record<string, unknown>; prompt_id: string }[] =>
  fake.promptCalls().map((c) => c.body as { prompt: Record<string, unknown>; prompt_id: string });

describe("AC-03 submission and completion", () => {
  test("each job is one /prompt with a UUID prompt_id and the combined graph with its attempt prefix", async () => {
    const [id] = addBatch(["a crate"]);
    const t = tracker();
    await runUntil(t, () => job(id ?? "").state === "done");
    const bodies = promptBodies();
    expect(bodies).toHaveLength(1);
    const body = bodies[0];
    expect(body?.prompt_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const expected = combineGraph(
      { kind: "prompt", prompt: "a crate", style: true, seed: 1000, faces: 10000, tex: 2048 },
      `asset-studio/${id ?? ""}/${body?.prompt_id ?? ""}`,
    );
    expect(body?.prompt).toEqual(expected as unknown as Record<string, unknown>);
    expect(assetFiles(id ?? "")).toEqual(["model.glb", "source.png", "thumb.png"]);
  });

  test("two batches finish in submission order", async () => {
    const first = addBatch(["a", "b"]);
    const second = addBatch(["c"]);
    const t = tracker();
    await runUntil(t, () => [...first, ...second].every((id) => job(id).state === "done"));
    const order = [...first, ...second].map((id) => job(id).finished_at ?? 0);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    const submitted = promptBodies().map((b) => b.prompt_id);
    expect(submitted).toEqual([...first, ...second].map((id) => job(id).prompt_id ?? ""));
  });

  test("outputs reported with Windows subfolders and empty extra entries are collected", async () => {
    fake.windowsPaths = true;
    const [id] = addBatch(["a crate"]);
    const t = tracker();
    await runUntil(t, () => job(id ?? "").state === "done", 40);
    expect(fake.promptCalls()).toHaveLength(1);
    expect(assetFiles(id ?? "")).toEqual(["model.glb", "source.png", "thumb.png"]);
  });

  test("an image job uploads its file and keeps the upload as its source", async () => {
    const [id] = addBatch(["chest.png"], { kind: "image" });
    const t = tracker();
    await runUntil(t, () => job(id ?? "").state === "done");
    expect(assetFiles(id ?? "")).toEqual(["model.glb", "source.png", "thumb.png"]);
    const graph = promptBodies()[0]?.prompt as Record<string, { class_type: string; inputs: { image?: string } }>;
    expect(graph["101"]?.inputs.image).toBe(`asset-studio/${id ?? ""}.png`);
  });

  test("an execution error ends the job failed with ComfyUI's message", async () => {
    const [id] = addBatch(["x"]);
    const t = tracker();
    fake.holdRunning = true;
    await t.tick();
    fake.failWith.set(job(id ?? "").prompt_id ?? "", "CUDA out of memory");
    fake.release();
    await runUntil(t, () => job(id ?? "").state !== "submitted");
    expect(job(id ?? "").state).toBe("failed");
    expect(job(id ?? "").error).toContain("CUDA out of memory");
  });

  test("a 400 from /prompt or /upload/image fails that job and the next job is still submitted", async () => {
    const [a, b] = addBatch(["bad", "good"]);
    fake.rejectNext = "Value not in list: ckpt_name";
    const t = tracker();
    await runUntil(t, () => job(b ?? "").state === "done");
    expect(job(a ?? "").state).toBe("failed");
    expect(job(a ?? "").error).toContain("Value not in list");
    const [c, d] = addBatch(["c.png", "d.png"], { kind: "image" });
    fake.rejectNextUpload = "Invalid image file";
    await runUntil(t, () => job(d ?? "").state === "done");
    expect(job(c ?? "").state).toBe("failed");
    expect(job(c ?? "").error).toContain("Invalid image file");
  });

  test("three server errors in a row fail the job while later jobs still run", async () => {
    const [a, b] = addBatch(["broken", "fine"]);
    const t = tracker();
    // The first job's attempt ID is known up front, so every post of it can answer 500.
    const pid = crypto.randomUUID();
    store.db.run("UPDATE jobs SET prompt_id = ? WHERE id = ?", [pid, a ?? ""]);
    fake.serverErrorFor.add(pid);
    await runUntil(t, () => job(a ?? "").state === "failed" && job(b ?? "").state === "done");
    expect(fake.promptCalls().filter((c) => (c.body as { prompt_id: string }).prompt_id === pid)).toHaveLength(3);
    expect(job(a ?? "").error).toContain("500");
  });
});

describe("AC-04 offline and incompatible ComfyUI", () => {
  test("while ComfyUI is down every state holds and health says offline; jobs finish when it returns", async () => {
    const [a, b] = addBatch(["a", "b"]);
    fake.holdRunning = true;
    const t = tracker();
    await t.tick();
    const port = fake.listeningPort;
    fake.stop();
    for (let i = 0; i < 3; i++) {
      clock.t += 2000;
      await t.tick();
    }
    expect(t.health().comfyui).toBe("offline");
    expect([job(a ?? "").state, job(b ?? "").state]).toEqual(["submitted", "submitted"]);
    fake.start(port);
    fake.release();
    await runUntil(t, () => job(b ?? "").state === "done");
    expect(t.health().comfyui).toBe("reachable");
  });

  test("a version change while up, or a restart reporting an old version, suspends every step", async () => {
    const [a, b] = addBatch(["a", "b"]);
    fake.holdRunning = true;
    const t = tracker();
    await t.tick();
    const callsBefore = fake.calls.filter((c) => c.method === "POST").length;
    fake.version = "0.46.1";
    clock.t += 2000;
    await t.tick();
    expect(t.health()).toEqual({ comfyui: "incompatible", version: "0.46.1" });
    fake.restart();
    for (let i = 0; i < 3; i++) {
      clock.t += 2000;
      await t.tick();
    }
    expect([job(a ?? "").state, job(b ?? "").state]).toEqual(["submitted", "submitted"]);
    expect(fake.calls.filter((c) => c.method === "POST").length).toBe(callsBefore);
    fake.version = "0.46.2";
    fake.release();
    await runUntil(t, () => job(b ?? "").state === "done");
  });
});

describe("AC-05 cancel and retry", () => {
  test("cancelling a pending job without an attempt makes no ComfyUI call", async () => {
    const [id] = addBatch(["a"]);
    requestCancel(store, id ?? "");
    await tracker().tick();
    expect(job(id ?? "").state).toBe("cancelled");
    expect(job(id ?? "").cancel_requested).toBe(0);
    expect(fake.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("queued and running jobs are cancelled with the per-job cancel, never /interrupt", async () => {
    const [a, b] = addBatch(["a", "b"]);
    fake.holdRunning = true;
    const t = tracker();
    await t.tick();
    await Bun.sleep(60);
    requestCancel(store, a ?? "");
    requestCancel(store, b ?? "");
    await t.tick();
    expect([job(a ?? "").state, job(b ?? "").state]).toEqual(["cancelled", "cancelled"]);
    const cancels = fake.calls.filter((c) => c.path.startsWith("/api/jobs/")).map((c) => c.path);
    expect(cancels.sort()).toEqual([`/api/jobs/${job(a ?? "").prompt_id ?? ""}/cancel`, `/api/jobs/${job(b ?? "").prompt_id ?? ""}/cancel`].sort());
    expect(fake.calls.some((c) => c.path === "/interrupt")).toBe(false);
  });

  test("a cancel after the prompt finished, or one that races its completion, ends done", async () => {
    const [a, b] = addBatch(["a", "b"]);
    const t = tracker();
    await runUntil(t, () => fake.promptCalls().length === 2);
    await Bun.sleep(150);
    requestCancel(store, a ?? "");
    await t.tick();
    expect(job(a ?? "").state).toBe("done");
    expect(fake.calls.some((c) => c.path === `/api/jobs/${job(a ?? "").prompt_id ?? ""}/cancel`)).toBe(false);
    const [c] = addBatch(["c"]);
    fake.holdRunning = true;
    await runUntil(t, () => job(c ?? "").state === "submitted");
    fake.finishOnCancel.add(job(c ?? "").prompt_id ?? "");
    requestCancel(store, c ?? "");
    await runUntil(t, () => job(c ?? "").state !== "submitted");
    expect(job(c ?? "").state).toBe("done");
    expect(job(b ?? "").state).toBe("done");
  });

  test("retry after a failure or a cancel runs a new prompt with the same seed and cleared flags", async () => {
    const [a] = addBatch(["a"]);
    const t = tracker();
    fake.holdRunning = true;
    await t.tick();
    const firstId = job(a ?? "").prompt_id ?? "";
    fake.failWith.set(firstId, "boom");
    fake.release();
    await runUntil(t, () => job(a ?? "").state === "failed");
    expect(retryJob(store, dirs.config, a ?? "").ok).toBe(true);
    expect(job(a ?? "")).toMatchObject({ state: "pending", prompt_id: null, error: null, started_at: null, server_errors: 0, cancel_requested: 0, attempts: 2 });
    await runUntil(t, () => job(a ?? "").state === "done");
    const ids = promptBodies().map((b) => b.prompt_id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(firstId);
    const seeds = promptBodies().map((b) => JSON.stringify(b.prompt).match(/"seed":(\d+)/)?.[1]);
    expect(seeds[0]).toBe(seeds[1]);
    const prefixes = promptBodies().map((b) => (b.prompt["136"] as { inputs: { filename_prefix: string } } | undefined)?.inputs.filename_prefix);
    expect(prefixes[0]).not.toBe(prefixes[1]);
    const [c] = addBatch(["c"]);
    requestCancel(store, c ?? "");
    await t.tick();
    expect(job(c ?? "").state).toBe("cancelled");
    expect(retryJob(store, dirs.config, c ?? "").ok).toBe(true);
    await runUntil(t, () => job(c ?? "").state === "done");
  });

  test("a retried job's timeout counts from its new start", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    const t = tracker();
    await runUntil(t, () => job(a ?? "").started_at !== null);
    clock.t += 15 * 60_000 + 1000;
    await t.tick();
    expect(job(a ?? "").state).toBe("failed");
    expect(job(a ?? "").error).toMatch(/15 minutes/);
    retryJob(store, dirs.config, a ?? "");
    await runUntil(t, () => job(a ?? "").started_at !== null);
    clock.t += 14 * 60_000;
    await t.tick();
    expect(job(a ?? "").state).toBe("submitted");
  });

  test("retry at the unfinished-job limit is refused", () => {
    const ids = addBatch(Array.from({ length: 100 }, (_, i) => `p${String(i)}`));
    const [extra] = addBatch(["x"]);
    store.db.run("UPDATE jobs SET state = 'failed' WHERE id = ?", [extra ?? ""]);
    const res = retryJob(store, dirs.config, extra ?? "");
    expect(res.ok).toBe(false);
    expect(ids).toHaveLength(100);
  });

  test("a pending job whose post timed out keeps its cancel until the late prompt appears, then cancels it", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    fake.promptAnswerDelayMs = 1500;
    fake.acceptAfterMs = 600;
    const t = tracker({ timeoutMs: 200 });
    await t.tick();
    expect(job(a ?? "")).toMatchObject({ state: "pending" });
    expect(job(a ?? "").prompt_id).not.toBeNull();
    clock.t += 5000;
    requestCancel(store, a ?? "");
    await t.tick();
    expect(job(a ?? "")).toMatchObject({ state: "pending", cancel_requested: 1 });
    await Bun.sleep(700);
    clock.t += 2000;
    await t.tick();
    expect(job(a ?? "").state).toBe("cancelled");
    expect(fake.calls.some((c) => c.path === `/api/jobs/${job(a ?? "").prompt_id ?? ""}/cancel`)).toBe(true);
    expect(fake.promptCalls()).toHaveLength(1);
  });

  test("a failing cancel call keeps the job and its flag, blocks submission, and succeeds later", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    const t = tracker();
    await runUntil(t, () => job(a ?? "").state === "submitted");
    fake.cancelStatus = 500;
    requestCancel(store, a ?? "");
    await t.tick();
    expect(job(a ?? "")).toMatchObject({ state: "submitted", cancel_requested: 1 });
    fake.cancelStatus = null;
    clock.t += 2000;
    await t.tick();
    expect(job(a ?? "").state).toBe("cancelled");
  });
});

describe("AC-06 restarts, losses and replay", () => {
  test("after an app restart jobs follow ComfyUI's queue and history", async () => {
    const [a, b] = addBatch(["a", "b"]);
    fake.holdRunning = true;
    await tracker().tick();
    fake.release();
    await Bun.sleep(200);
    await runUntil(tracker(), () => job(a ?? "").state === "done" && job(b ?? "").state === "done");
    expect(fake.promptCalls()).toHaveLength(2);
  });

  test("a lost job's resubmission restarts its queued time, like a retry (AC-26)", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    const t = tracker();
    await runUntil(t, () => job(a ?? "").state === "submitted");
    const before = (store.db.query("SELECT queued_at FROM jobs WHERE id = ?").get(a ?? "") as { queued_at: number }).queued_at;
    fake.restart();
    clock.t += 60_000;
    await t.tick();
    const row = store.db.query("SELECT queued_at, losses FROM jobs WHERE id = ?").get(a ?? "") as { queued_at: number; losses: number };
    expect(row.losses).toBe(1);
    expect(row.queued_at).toBeGreaterThan(before);
    expect(row.queued_at).toBe(clock.t);
  });

  test("a job ComfyUI lost is resubmitted with a new prompt and prefix, and fails on the third loss", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    const t = tracker();
    for (let loss = 1; loss <= 3; loss++) {
      await runUntil(t, () => job(a ?? "").state === "submitted");
      fake.restart();
      clock.t += 2000;
      await t.tick();
    }
    expect(job(a ?? "").state).toBe("failed");
    expect(job(a ?? "").error).toMatch(/lost/);
    const ids = promptBodies().map((b) => b.prompt_id);
    expect(new Set(ids).size).toBe(3);
  });

  test("an attempt posted before a crash is adopted, not posted again", async () => {
    const [a] = addBatch(["a"]);
    const promptId = crypto.randomUUID();
    store.db.run("UPDATE jobs SET prompt_id = ?, posted_at = ? WHERE id = ?", [promptId, clock.t, a ?? ""]);
    const graph = combineGraph({ kind: "prompt", prompt: "a", style: true, seed: 1000, faces: 10000, tex: 2048 }, `asset-studio/${a ?? ""}/${promptId}`);
    fake.holdRunning = true;
    await fetch(`${fake.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph, prompt_id: promptId }) });
    await tracker().tick();
    expect(job(a ?? "").state).toBe("submitted");
    expect(fake.promptCalls()).toHaveLength(1);
  });

  test("a prompt accepted after the client timed out is adopted without a second post", async () => {
    const [a] = addBatch(["a"]);
    fake.promptAnswerDelayMs = 1500;
    fake.acceptAfterMs = 600;
    const t = tracker({ timeoutMs: 200 });
    await t.tick();
    expect(job(a ?? "").state).toBe("pending");
    clock.t += 2000;
    await t.tick();
    expect(fake.promptCalls()).toHaveLength(1);
    await Bun.sleep(700);
    fake.promptAnswerDelayMs = 0;
    await runUntil(t, () => job(a ?? "").state === "done");
    expect(fake.promptCalls()).toHaveLength(1);
  });

  test("missing output files count as a loss and the next attempt has a new prefix", async () => {
    const [a] = addBatch(["a"]);
    const t = tracker();
    fake.holdRunning = true;
    await t.tick();
    const first = job(a ?? "").prompt_id ?? "";
    fake.release();
    await Bun.sleep(150);
    fake.dropOutputs(first);
    await runUntil(t, () => job(a ?? "").state === "done");
    const prefixes = promptBodies().map((b) => (b.prompt["136"] as { inputs: { filename_prefix: string } }).inputs.filename_prefix);
    expect(prefixes).toHaveLength(2);
    expect(prefixes[0]).not.toBe(prefixes[1]);
  });

  test("a crash during collection never leaves a half-written asset", async () => {
    for (const point of ["afterFirstFile", "afterRename"] as const) {
      const [a] = addBatch([point]);
      const crashing = tracker({ faults: { [point]: () => { throw new Error("crash"); } } });
      fake.holdRunning = true;
      await runUntil(crashing, () => job(a ?? "").state === "submitted");
      fake.release();
      await Bun.sleep(150);
      await crashing.tick().catch(() => undefined);
      expect(job(a ?? "").state).toBe("submitted");
      if (point === "afterFirstFile") expect(existsSync(join(dirs.config.dataDir, "assets", a ?? ""))).toBe(false);
      await runUntil(tracker(), () => job(a ?? "").state === "done");
      expect(assetFiles(a ?? "")).toEqual(["model.glb", "source.png", "thumb.png"]);
    }
  });

  test("a timeout that races the prompt's completion ends done", async () => {
    const [a] = addBatch(["a"]);
    fake.holdRunning = true;
    const t = tracker();
    await runUntil(t, () => job(a ?? "").started_at !== null);
    fake.finishOnCancel.add(job(a ?? "").prompt_id ?? "");
    clock.t += 16 * 60_000;
    await runUntil(t, () => job(a ?? "").state !== "submitted");
    expect(job(a ?? "").state).toBe("done");
  });

  test("the start sweep removes leftovers in ComfyUI's folders and orphaned uploads", async () => {
    const [a] = addBatch(["a"]);
    const crashing = tracker({ faults: { afterDone: () => { throw new Error("crash"); } } });
    fake.holdRunning = true;
    await runUntil(crashing, () => job(a ?? "").state === "submitted");
    fake.release();
    await Bun.sleep(150);
    await crashing.tick().catch(() => undefined);
    expect(job(a ?? "").state).toBe("done");
    expect(existsSync(join(dirs.config.comfyOutputDir, a ?? ""))).toBe(true);
    const orphan = join(dirs.config.dataDir, "uploads", crypto.randomUUID());
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, "0.png"), "x");
    tracker().sweep();
    expect(existsSync(join(dirs.config.comfyOutputDir, a ?? ""))).toBe(false);
    expect(existsSync(orphan)).toBe(false);
  });

  test("a batch killed between its uploads rename and its commit leaves no rows, and the start sweep removes its uploads", async () => {
    const id = crypto.randomUUID();
    const form = new FormData();
    form.set("presets", JSON.stringify({ engine: "trellis", faces: 10000, tex: 2048, variants: 1, style: true, seed: null }));
    form.append("images", new Blob([solidPng(8, 8, [10, 20, 30])]), "crate.png");
    const req = new Request("http://app/api/batches", { method: "POST", headers: { "x-batch-id": id }, body: form });
    const kill = (): void => { throw new Error("killed"); };
    let thrown: string;
    try {
      const res = await createBatch(req, { store, config: dirs.config, now: () => clock.t, faults: { afterRename: kill } });
      thrown = `answered ${String(res.status)} ${await res.text()}`;
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    expect(thrown).toBe("killed");
    expect((store.db.query("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n).toBe(0);
    const orphan = join(dirs.config.dataDir, "uploads", id);
    expect(existsSync(orphan)).toBe(true);
    const restarted = tracker();
    restarted.start();
    await restarted.stop();
    expect(existsSync(orphan)).toBe(false);
  });

  test("the sweep removes a cancelled job's leftover ComfyUI output once ComfyUI no longer queues it", async () => {
    const [a] = addBatch(["a"]);
    store.db.run("UPDATE jobs SET state = 'cancelled', prompt_id = ? WHERE id = ?", [crypto.randomUUID(), a ?? ""]);
    const leftover = join(dirs.config.comfyOutputDir, a ?? "");
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "x_00001_.glb"), "x");
    const t = tracker();
    await t.tick();
    t.sweep();
    expect(existsSync(leftover)).toBe(false);
  });

  test("fixture jobs are never timed out", async () => {
    const [f] = addBatch(["fixture"], { fixture: true });
    store.db.run("UPDATE jobs SET state = 'submitted', prompt_id = ?, started_at = ? WHERE id = ?", [crypto.randomUUID(), clock.t, f ?? ""]);
    const fixtureFake = new FakeComfy({ outputDir: join(dirs.root, "fx-out"), inputDir: join(dirs.root, "fx-in"), dataDir: dirs.config.dataDir });
    fixtureFake.start();
    try {
      const t = new Tracker({ store, config: dirs.config, comfy: new ComfyClient(fixtureFake.url, { timeoutMs: 10_000 }), now: () => clock.t });
      clock.t += 20 * 60_000;
      await t.tick();
      expect(job(f ?? "").state).toBe("submitted");
    } finally {
      fixtureFake.stop();
    }
  });
});

describe("AC-23 Hunyuan3D jobs are cancelled and deleted", () => {
  type St = "pending" | "submitted" | "done" | "failed" | "cancelled";
  /** One job of `engine` in `state`, with an asset directory and ComfyUI output and input files. */
  function makeJob(engine: "trellis" | "hunyuan", state: St, opts: { promptId?: string; postedAt?: number } = {}): string {
    const [id = ""] = addBatch([`${engine} ${state}`], { engine });
    store.db.run("UPDATE jobs SET state = ?, prompt_id = ?, posted_at = ? WHERE id = ?", [state, opts.promptId ?? null, opts.postedAt ?? null, id]);
    const assets = join(dirs.config.dataDir, "assets", id);
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "model.glb"), `glb ${id}`);
    if (engine === "hunyuan") {
      mkdirSync(join(dirs.config.comfyOutputDir, id), { recursive: true });
      writeFileSync(join(dirs.config.comfyOutputDir, id, "x_00001_.glb"), "x");
      mkdirSync(dirs.config.comfyInputDir, { recursive: true });
      writeFileSync(join(dirs.config.comfyInputDir, `${id}.png`), "x");
    }
    return id;
  }
  const exists = (id: string): boolean => getJob(store, id) !== null;
  const cancelCalls = (): string[] => fake.calls.filter((c) => c.method === "POST" && c.path.endsWith("/cancel")).map((c) => c.path.split("/")[3] ?? "");

  async function queueOnFake(promptId: string): Promise<void> {
    fake.holdRunning = true;
    const res = await fetch(`${fake.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: { "1": { class_type: "Hunyuan3Dv2Conditioning", inputs: {} } }, prompt_id: promptId }) });
    expect(res.ok).toBe(true);
  }

  test("one tick cancels the unfinished ones, deletes every finished one with its files, and posts no Hunyuan3D graph", async () => {
    const submittedPrompt = crypto.randomUUID();
    await queueOnFake(submittedPrompt);
    const h = {
      pendingNoAttempt: makeJob("hunyuan", "pending"),
      submitted: makeJob("hunyuan", "submitted", { promptId: submittedPrompt, postedAt: clock.t - 60_000 }),
      done: makeJob("hunyuan", "done"),
      failed: makeJob("hunyuan", "failed"),
      cancelled: makeJob("hunyuan", "cancelled"),
    };
    const t = { done: makeJob("trellis", "done"), failed: makeJob("trellis", "failed"), cancelled: makeJob("trellis", "cancelled") };
    const before = Object.fromEntries(Object.values(t).map((id) => [id, { row: JSON.stringify(job(id)), glb: readFileSync(join(dirs.config.dataDir, "assets", id, "model.glb"), "utf8") }]));
    fake.calls.length = 0;
    await tracker().tick();
    for (const id of Object.values(h)) {
      expect(exists(id)).toBe(false);
      expect(existsSync(join(dirs.config.dataDir, "assets", id))).toBe(false);
      expect(existsSync(join(dirs.config.comfyOutputDir, id))).toBe(false);
      expect(existsSync(join(dirs.config.comfyInputDir, `${id}.png`))).toBe(false);
    }
    expect(cancelCalls()).toContain(submittedPrompt);
    expect(promptBodies().filter((b) => JSON.stringify(b.prompt).toLowerCase().includes("hunyuan"))).toEqual([]);
    const batches = (store.db.query("SELECT COUNT(*) AS n FROM batches b WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.batch_id = b.id)").get() as { n: number }).n;
    expect(batches).toBe(0);
    for (const id of Object.values(t)) {
      expect(JSON.stringify(job(id))).toBe(before[id]?.row ?? "");
      expect(readFileSync(join(dirs.config.dataDir, "assets", id, "model.glb"), "utf8")).toBe(before[id]?.glb ?? "");
    }
  });

  test("a pending one posted 10 seconds ago waits out the 30 seconds, then is cancelled and deleted", async () => {
    const id = makeJob("hunyuan", "pending", { promptId: crypto.randomUUID(), postedAt: clock.t - 10_000 });
    const t = tracker();
    await t.tick();
    expect(job(id).state).toBe("pending");
    clock.t += 25_000;
    await t.tick();
    await t.tick();
    expect(exists(id)).toBe(false);
    expect(promptBodies()).toEqual([]);
  });

  test("a failing cancel keeps the row until a later tick succeeds, and the tick never submits it", async () => {
    const promptId = crypto.randomUUID();
    await queueOnFake(promptId);
    const id = makeJob("hunyuan", "submitted", { promptId, postedAt: clock.t - 60_000 });
    fake.calls.length = 0;
    fake.cancelStatus = 500;
    const t = tracker();
    await t.tick();
    await t.tick();
    expect(exists(id)).toBe(true);
    fake.cancelStatus = null;
    await t.tick();
    expect(exists(id)).toBe(false);
    expect(promptBodies()).toEqual([]);
  });

  test("retrying a Hunyuan3D job is refused with the Hunyuan3D message", () => {
    const id = makeJob("hunyuan", "failed");
    const res = retryJob(store, dirs.config, id);
    expect(res).toEqual({ ok: false, status: 400, error: "Hunyuan3D is no longer available; use TRELLIS.2." });
  });

  test("a second tick with nothing left to remove cancels and deletes nothing", async () => {
    const keep = makeJob("trellis", "done");
    const t = tracker();
    await t.tick();
    fake.calls.length = 0;
    await t.tick();
    expect(cancelCalls()).toEqual([]);
    expect(exists(keep)).toBe(true);
  });
});

describe("AC-28 Shared style in graphs and retries", () => {
  function sharedJob(shared: string | null, style: boolean): string {
    const [id = ""] = addBatch(["a crate"]);
    store.db.run("UPDATE jobs SET shared_style = ?, style = ? WHERE id = ?", [shared, style ? 1 : 0, id]);
    return id;
  }
  const promptText = (): string => {
    const body = promptBodies().at(-1);
    const node = body?.prompt["5"] as { inputs: { text?: string } } | undefined;
    return node?.inputs.text ?? JSON.stringify(body?.prompt ?? {});
  };
  test("the prompt text is the prompt, then the Shared style, then the game-asset suffix", async () => {
    sharedJob("low-poly, flat shaded", true);
    await tracker().tick();
    expect(promptText()).toStartWith("a crate, low-poly, flat shaded, single object");
  });
  test("with the style off the suffix is left out", async () => {
    sharedJob("low-poly", false);
    await tracker().tick();
    expect(promptText()).toBe("a crate, low-poly");
  });
  test("a retry posts the same text and resets queued_at", async () => {
    const id = sharedJob("hand-painted", true);
    store.db.run("UPDATE jobs SET state = 'failed', queued_at = 1 WHERE id = ?", [id]);
    clock.t += 60_000;
    expect(retryJob(store, dirs.config, id, clock.t)).toEqual({ ok: true });
    expect((store.db.query("SELECT queued_at FROM jobs WHERE id = ?").get(id) as { queued_at: number }).queued_at).toBe(clock.t);
    await tracker().tick();
    expect(promptText()).toStartWith("a crate, hand-painted, single object");
  });
});
