// Development fixture: fixed fixture jobs in every state the page renders. Only runs against the fake
// ComfyUI, touches only rows with the fixture flag, and is repeatable.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { solidPng, texturedGlb } from "../fake-comfy/assets.ts";
import type { Config } from "./config.ts";
import { isFakeComfy } from "./serve.ts";
import { openStore, type Store } from "./store.ts";
import { createReporter } from "../cli/report.ts";

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const FIXTURE_BATCH_PROMPTS = id(0x100);
export const FIXTURE_BATCH_IMAGES = id(0x101);
/** A batch of four jobs (done, Generating, Queued, failed) for the queue's batch group. */
export const FIXTURE_BATCH_SET = id(0x102);
/** One cancelled Ultra job alone in its batch, so no asserted count, estimate or retry result changes. */
export const FIXTURE_BATCH_ULTRA = id(0x103);
/** Two done assets outside Standard, the oldest batch, so Remix and the Quality labels have a High and a Custom pair. */
export const FIXTURE_BATCH_QUALITY = id(0x104);
/** The done High asset (20000 triangles with 2048 textures). */
export const FIXTURE_HIGH = id(15);
/** The done asset whose pair matches no Quality level (5000 triangles with 2048 textures). */
export const FIXTURE_CUSTOM = id(16);
const FIXTURE_BATCHES = [FIXTURE_BATCH_PROMPTS, FIXTURE_BATCH_IMAGES, FIXTURE_BATCH_SET, FIXTURE_BATCH_ULTRA, FIXTURE_BATCH_QUALITY];
const MIN = 60_000;

interface FixtureJob {
  id: string;
  batch: string;
  position: number;
  kind: "prompt" | "image";
  text: string;
  state: "done" | "failed" | "cancelled" | "submitted";
  promptId?: string;
  running?: boolean;
  error?: string;
  /** Ultra: 30000 triangles with 4096 textures instead of 10000 and 2048. */
  ultra?: boolean;
  /** Triangles and texture when neither Standard nor Ultra. */
  faces?: number;
  tex?: number;
  /** Times before the seed time T, in ms: when the current attempt was queued, started and finished. */
  queuedAgo: number;
  startedAgo?: number | null;
  finishedAgo?: number;
}

/** A prompt near the 2000-character limit with one 120-character unbroken word, for the long-content checks. */
export const LONG_PROMPT = (() => {
  const word = "ancient-carved-runestone-" + "x".repeat(95);
  const base = "a weathered stone archway overgrown with moss and glowing violet crystals, carved with spiral runes, " + word + " ";
  let text = base;
  while (text.length < 1990) text += "standing on a cracked flagstone base beside a fallen pillar, lit by a low sun, ";
  return text.slice(0, 1990).trim();
})();

// Times are fixed relative to the seed time T so the page's durations and estimates are deterministic.
// Done jobs generated in 6 min 40 s (400 s) after waiting 1 min, except 木箱, whose start the app never saw.
const done = (queuedAgo: number): Pick<FixtureJob, "queuedAgo" | "startedAgo" | "finishedAgo"> => ({ queuedAgo, startedAgo: queuedAgo - MIN, finishedAgo: queuedAgo - MIN - 400_000 });
export const FIXTURE_JOBS: FixtureJob[] = [
  { id: id(1), batch: FIXTURE_BATCH_PROMPTS, position: 0, kind: "prompt", text: "a wooden treasure chest", state: "done", ...done(120 * MIN) },
  { id: id(2), batch: FIXTURE_BATCH_PROMPTS, position: 1, kind: "prompt", text: "a rusty sci-fi pistol", state: "done", ...done(115 * MIN) },
  { id: id(3), batch: FIXTURE_BATCH_PROMPTS, position: 2, kind: "prompt", text: "木箱", state: "done", queuedAgo: 110 * MIN, startedAgo: null, finishedAgo: 90 * MIN },
  { id: id(4), batch: FIXTURE_BATCH_PROMPTS, position: 3, kind: "prompt", text: "a stone pillar", state: "done", ...done(105 * MIN) },
  { id: id(5), batch: FIXTURE_BATCH_PROMPTS, position: 4, kind: "prompt", text: "a cursed lantern", state: "failed", error: "CUDA out of memory (fixture)", queuedAgo: 100 * MIN, finishedAgo: 95 * MIN },
  { id: id(6), batch: FIXTURE_BATCH_PROMPTS, position: 5, kind: "prompt", text: "a broken shield", state: "cancelled", queuedAgo: 100 * MIN, finishedAgo: 99 * MIN },
  { id: id(10), batch: FIXTURE_BATCH_PROMPTS, position: 8, kind: "prompt", text: LONG_PROMPT, state: "done", ...done(95 * MIN) },
  { id: id(11), batch: FIXTURE_BATCH_PROMPTS, position: 9, kind: "prompt", text: LONG_PROMPT, state: "failed", error: "CUDA out of memory (fixture)", queuedAgo: 90 * MIN, finishedAgo: 85 * MIN },
  { id: id(9), batch: FIXTURE_BATCH_IMAGES, position: 0, kind: "image", text: "old-chest.png", state: "done", ...done(80 * MIN) },
  // The four-job batch: its Generating job is the one fixture job the fake runs, with a seeded thumbnail.
  { id: id(12), batch: FIXTURE_BATCH_SET, position: 0, kind: "prompt", text: "a mossy stone well", state: "done", ...done(30 * MIN) },
  { id: id(7), batch: FIXTURE_BATCH_SET, position: 1, kind: "prompt", text: "a glowing crystal", state: "submitted", promptId: id(0x201), running: true, queuedAgo: 12 * MIN, startedAgo: 3 * MIN },
  { id: id(8), batch: FIXTURE_BATCH_SET, position: 2, kind: "prompt", text: "a potion bottle", state: "submitted", promptId: id(0x202), queuedAgo: 12 * MIN },
  { id: id(13), batch: FIXTURE_BATCH_SET, position: 3, kind: "prompt", text: "an iron anvil", state: "failed", error: "CUDA out of memory (fixture)", queuedAgo: 12 * MIN, finishedAgo: 11 * MIN },
  { id: id(14), batch: FIXTURE_BATCH_ULTRA, position: 0, kind: "prompt", text: "an ornate dragon statue", state: "cancelled", ultra: true, queuedAgo: 60 * MIN, finishedAgo: 59 * MIN },
  { id: FIXTURE_HIGH, batch: FIXTURE_BATCH_QUALITY, position: 0, kind: "prompt", text: "a carved wooden totem", state: "done", faces: 20000, tex: 2048, ...done(140 * MIN) },
  { id: FIXTURE_CUSTOM, batch: FIXTURE_BATCH_QUALITY, position: 1, kind: "prompt", text: "an old iron key", state: "done", faces: 5000, tex: 2048, ...done(140 * MIN) },
];

function clear(store: Store, config: Config): void {
  const rows = store.db.query("SELECT id, batch_id FROM jobs WHERE fixture = 1").all() as { id: string; batch_id: string }[];
  store.db.transaction(() => {
    store.db.run("DELETE FROM jobs WHERE fixture = 1");
    store.db.run(`DELETE FROM batches WHERE id IN (${FIXTURE_BATCHES.map(() => "?").join(", ")}) AND NOT EXISTS (SELECT 1 FROM jobs WHERE batch_id = batches.id)`, FIXTURE_BATCHES);
  })();
  for (const r of rows) rmSync(join(config.dataDir, "assets", r.id), { recursive: true, force: true });
  for (const b of FIXTURE_BATCHES) rmSync(join(config.dataDir, "uploads", b), { recursive: true, force: true });
  for (const r of rows) rmSync(join(config.comfyOutputDir, r.id), { recursive: true, force: true });
}

export function seedFixture(store: Store, config: Config, profile: string, now: number): number {
  clear(store, config);
  if (profile === "empty") return 0;
  store.db.transaction(() => {
    for (const [batch, kind, ago] of [[FIXTURE_BATCH_PROMPTS, "prompt", 120 * MIN], [FIXTURE_BATCH_IMAGES, "image", 80 * MIN], [FIXTURE_BATCH_SET, "prompt", 12 * MIN], [FIXTURE_BATCH_ULTRA, "prompt", 60 * MIN], [FIXTURE_BATCH_QUALITY, "prompt", 140 * MIN]] as const) {
      store.db.run("INSERT OR IGNORE INTO batches (id, kind, presets, hash, created_at) VALUES (?, ?, '{}', ?, ?)", [batch, kind, `fixture-${batch}`, now - ago]);
    }
    for (const j of FIXTURE_JOBS) {
      store.db.run(
        `INSERT INTO jobs (id, batch_id, position, kind, prompt, upload_name, upload_ext, engine, faces, tex, style, seed, state, prompt_id,
           posted_at, fixture, error, created_at, queued_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        [j.id, j.batch, j.position, j.kind, j.kind === "prompt" ? j.text : null, j.kind === "image" ? j.text : null, j.kind === "image" ? "png" : null,
          "trellis", j.faces ?? (j.ultra ? 30000 : 10000), j.tex ?? (j.ultra ? 4096 : 2048), 1000 + j.position, j.state, j.promptId ?? null, j.promptId ? now - j.queuedAgo : null,
          j.error ?? null, now - j.queuedAgo, now - j.queuedAgo,
          j.startedAgo === undefined || j.startedAgo === null ? null : now - j.startedAgo,
          j.finishedAgo === undefined ? null : now - j.finishedAgo],
      );
    }
  })();
  const colours: [number, number, number][] = [[180, 120, 60], [120, 130, 140], [150, 90, 40], [130, 130, 120], [200, 200, 80], [90, 110, 170]];
  FIXTURE_JOBS.filter((j) => j.state === "done").forEach((j, i) => {
    const dir = join(config.dataDir, "assets", j.id);
    mkdirSync(dir, { recursive: true });
    const rgb = colours[i % colours.length] ?? [128, 128, 128];
    writeFileSync(join(dir, "model.glb"), texturedGlb(rgb));
    writeFileSync(join(dir, "source.png"), solidPng(256, 256, rgb));
    writeFileSync(join(dir, "thumb.png"), solidPng(64, 64, rgb));
    if (j.kind === "image") {
      mkdirSync(join(config.dataDir, "uploads", j.batch), { recursive: true });
      writeFileSync(join(config.dataDir, "uploads", j.batch, `${String(j.position)}.png`), solidPng(256, 256, rgb));
    }
  });
  // The running fixture job's source thumbnail, where its graph would write it in ComfyUI's output folder.
  for (const j of FIXTURE_JOBS.filter((f) => f.running && f.promptId)) {
    const dir = join(config.comfyOutputDir, j.id, j.promptId ?? "");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "thumb_00001_.png"), solidPng(256, 256, [120, 170, 220]));
  }
  return FIXTURE_JOBS.length;
}

export async function runSeed(config: Config, opts: { profile: string; reset: boolean }): Promise<number> {
  const report = createReporter();
  if (!(await isFakeComfy(config.comfyuiUrl))) {
    report.fail(`${config.comfyuiUrl} is not the fake ComfyUI; the seed only runs against the fake`);
    return 1;
  }
  if (opts.profile !== "default" && opts.profile !== "empty") {
    report.fail(`unknown profile ${opts.profile} (default or empty)`);
    return 2;
  }
  const store = openStore(config.dataDir);
  try {
    if (opts.reset) {
      clear(store, config);
      report.pass("removed fixture jobs");
      return 0;
    }
    const n = seedFixture(store, config, opts.profile, Date.now());
    if (n) report.pass(`seeded ${String(n)} fixture jobs`);
    else report.none("empty profile, fixture jobs removed");
    return 0;
  } finally {
    store.close();
  }
}
