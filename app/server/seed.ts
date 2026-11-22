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
}

/** A prompt near the 2000-character limit with one 120-character unbroken word, for the long-content checks. */
export const LONG_PROMPT = (() => {
  const word = "ancient-carved-runestone-" + "x".repeat(95);
  const base = "a weathered stone archway overgrown with moss and glowing violet crystals, carved with spiral runes, " + word + " ";
  let text = base;
  while (text.length < 1990) text += "standing on a cracked flagstone base beside a fallen pillar, lit by a low sun, ";
  return text.slice(0, 1990).trim();
})();

export const FIXTURE_JOBS: FixtureJob[] = [
  { id: id(1), batch: FIXTURE_BATCH_PROMPTS, position: 0, kind: "prompt", text: "a wooden treasure chest", state: "done" },
  { id: id(2), batch: FIXTURE_BATCH_PROMPTS, position: 1, kind: "prompt", text: "a rusty sci-fi pistol", state: "done" },
  { id: id(3), batch: FIXTURE_BATCH_PROMPTS, position: 2, kind: "prompt", text: "木箱", state: "done" },
  { id: id(4), batch: FIXTURE_BATCH_PROMPTS, position: 3, kind: "prompt", text: "a stone pillar", state: "done" },
  { id: id(5), batch: FIXTURE_BATCH_PROMPTS, position: 4, kind: "prompt", text: "a cursed lantern", state: "failed", error: "CUDA out of memory (fixture)" },
  { id: id(6), batch: FIXTURE_BATCH_PROMPTS, position: 5, kind: "prompt", text: "a broken shield", state: "cancelled" },
  { id: id(7), batch: FIXTURE_BATCH_PROMPTS, position: 6, kind: "prompt", text: "a glowing crystal", state: "submitted", promptId: id(0x201), running: true },
  { id: id(8), batch: FIXTURE_BATCH_PROMPTS, position: 7, kind: "prompt", text: "a potion bottle", state: "submitted", promptId: id(0x202) },
  { id: id(9), batch: FIXTURE_BATCH_IMAGES, position: 0, kind: "image", text: "old-chest.png", state: "done" },
  { id: id(10), batch: FIXTURE_BATCH_PROMPTS, position: 8, kind: "prompt", text: LONG_PROMPT, state: "done" },
  { id: id(11), batch: FIXTURE_BATCH_PROMPTS, position: 9, kind: "prompt", text: LONG_PROMPT, state: "failed", error: "CUDA out of memory (fixture)" },
];

function clear(store: Store, config: Config): void {
  const rows = store.db.query("SELECT id, batch_id FROM jobs WHERE fixture = 1").all() as { id: string; batch_id: string }[];
  store.db.transaction(() => {
    store.db.run("DELETE FROM jobs WHERE fixture = 1");
    store.db.run(`DELETE FROM batches WHERE id IN (?, ?) AND NOT EXISTS (SELECT 1 FROM jobs WHERE batch_id = batches.id)`, [FIXTURE_BATCH_PROMPTS, FIXTURE_BATCH_IMAGES]);
  })();
  for (const r of rows) rmSync(join(config.dataDir, "assets", r.id), { recursive: true, force: true });
  for (const b of [FIXTURE_BATCH_PROMPTS, FIXTURE_BATCH_IMAGES]) rmSync(join(config.dataDir, "uploads", b), { recursive: true, force: true });
}

export function seedFixture(store: Store, config: Config, profile: string, now: number): number {
  clear(store, config);
  if (profile === "empty") return 0;
  store.db.transaction(() => {
    for (const [batch, kind] of [[FIXTURE_BATCH_PROMPTS, "prompt"], [FIXTURE_BATCH_IMAGES, "image"]] as const) {
      store.db.run("INSERT OR IGNORE INTO batches (id, kind, presets, hash, created_at) VALUES (?, ?, '{}', ?, ?)", [batch, kind, `fixture-${batch}`, now - (kind === "prompt" ? 1000 : 0)]);
    }
    for (const j of FIXTURE_JOBS) {
      store.db.run(
        `INSERT INTO jobs (id, batch_id, position, kind, prompt, upload_name, upload_ext, engine, faces, tex, style, seed, state, prompt_id,
           posted_at, fixture, error, created_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10000, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [j.id, j.batch, j.position, j.kind, j.kind === "prompt" ? j.text : null, j.kind === "image" ? j.text : null, j.kind === "image" ? "png" : null,
          "trellis", 2048, 1000 + j.position, j.state, j.promptId ?? null, j.promptId ? now : null,
          j.error ?? null, now - (j.batch === FIXTURE_BATCH_PROMPTS ? 1000 : 0), j.running ? now : null,
          ["done", "failed", "cancelled"].includes(j.state) ? now : null],
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
