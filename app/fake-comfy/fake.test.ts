import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeComfy } from "./fake.ts";

let dir: string;
let fake: FakeComfy;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fake-comfy-"));
  fake = new FakeComfy({ outputDir: join(dir, "out"), inputDir: join(dir, "in"), runMs: 10 });
  fake.start();
});
afterEach(() => {
  fake.stop();
  rmSync(dir, { recursive: true, force: true });
});

const graph = {
  "1": { class_type: "SaveGLB", inputs: { filename_prefix: "asset-studio/job/att" } },
  "2": { class_type: "SaveImage", inputs: { filename_prefix: "asset-studio/job/att/thumb" } },
};

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(fake.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function waitHistory(id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 100; i++) {
    const h = (await (await fetch(`${fake.url}/history/${id}`)).json()) as Record<string, Record<string, unknown>>;
    if (h[id]) return h[id];
    await Bun.sleep(10);
  }
  throw new Error("no history");
}

test("runs a prompt with the client prompt id and serves its outputs", async () => {
  const id = crypto.randomUUID();
  const res = (await (await post("/prompt", { prompt: graph, prompt_id: id })).json()) as { prompt_id: string };
  expect(res.prompt_id).toBe(id);
  const entry = (await waitHistory(id)) as { status: { status_str: string }; outputs: Record<string, Record<string, { filename: string; subfolder: string }[]>> };
  expect(entry.status.status_str).toBe("success");
  const glb = entry.outputs["1"]?.["3d"]?.[0];
  expect(glb?.subfolder).toBe("asset-studio/job");
  const view = await fetch(`${fake.url}/view?filename=${glb?.filename ?? ""}&subfolder=${glb?.subfolder ?? ""}&type=output`);
  const bytes = new Uint8Array(await view.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("glTF");
});

test("rejects a non-UUID prompt id and a rejected prompt with 400", async () => {
  expect((await post("/prompt", { prompt: graph, prompt_id: "nope" })).status).toBe(400);
  fake.rejectNext = "missing model";
  const res = await post("/prompt", { prompt: graph, prompt_id: crypto.randomUUID() });
  expect(res.status).toBe(400);
  expect(JSON.stringify(await res.json())).toContain("missing model");
});

test("per-job cancel removes pending, interrupts running, and answers false for unknown", async () => {
  fake.holdRunning = true;
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  await post("/prompt", { prompt: graph, prompt_id: a });
  await post("/prompt", { prompt: graph, prompt_id: b });
  await Bun.sleep(30);
  expect(await (await post(`/api/jobs/${b}/cancel`, {})).json()).toEqual({ cancelled: true });
  expect(await (await post(`/api/jobs/${a}/cancel`, {})).json()).toEqual({ cancelled: true });
  const entry = (await waitHistory(a)) as { status: { status_str: string; messages: [string][] } };
  expect(entry.status.status_str).toBe("error");
  expect(entry.status.messages[0]?.[0]).toBe("execution_interrupted");
  expect(await (await post(`/api/jobs/${crypto.randomUUID()}/cancel`, {})).json()).toEqual({ cancelled: false });
  expect(fake.calls.some((c) => c.path === "/interrupt")).toBe(false);
});

test("restart drops queue and history; version is settable", async () => {
  const id = crypto.randomUUID();
  await post("/prompt", { prompt: graph, prompt_id: id });
  await waitHistory(id);
  fake.restart();
  expect(await (await fetch(`${fake.url}/history/${id}`)).json()).toEqual({});
  fake.version = "0.46.1";
  const stats = (await (await fetch(`${fake.url}/system_stats`)).json()) as { system: { comfyui_version: string } };
  expect(stats.system.comfyui_version).toBe("0.46.1");
  expect((await fetch(`${fake.url}/asset-studio-fake`)).status).toBe(200);
});

test("hold-accept keeps /prompt unanswered and nothing queued until release-accept", async () => {
  const f = new FakeComfy({ outputDir: join(tmpdir(), `fake-out-${crypto.randomUUID()}`), inputDir: join(tmpdir(), `fake-in-${crypto.randomUUID()}`), runMs: 10 });
  f.start();
  try {
    await fetch(`${f.url}/_control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "hold-accept" }) });
    const id = crypto.randomUUID();
    const seen = { answered: false };
    const post = fetch(`${f.url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: {}, prompt_id: id }) }).then((r) => { seen.answered = true; return r; });
    const queued = async (): Promise<string> => JSON.stringify(await (await fetch(`${f.url}/queue`)).json());
    // A negative check: give an unheld fake ample time to answer, then confirm it did not.
    for (let i = 0; i < 10 && !seen.answered; i++) await Bun.sleep(20);
    expect(seen.answered).toBe(false);
    expect(await queued()).not.toContain(id);
    await fetch(`${f.url}/_control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "release-accept" }) });
    expect((await post).ok).toBe(true);
  } finally {
    f.stop();
  }
});
