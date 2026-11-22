// The tracker: one loop that does all work against ComfyUI's API. Each tick reads ComfyUI's version, then
// handles cancel requests, submits pending jobs, reconciles submitted jobs against the queue and history,
// and times out long runs. The rules are in the feature document's Design; tracker.test.ts holds them.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { combineGraph, type JobGraphInput } from "../pipeline/combine.ts";
import { ComfyError, type ComfyClient, type HistoryEntry, type QueueSnapshot } from "./comfy.ts";
import type { Config } from "./config.ts";
import { assetDir, completeAsset, MIME, removeComfyFiles, uploadPath } from "./files.ts";
import { deleteJob } from "./assets.ts";
import type { ComfyState, TrackerView } from "./http.ts";
import type { JobRow, QueueInfo } from "./jobs.ts";
import type { Store } from "./store.ts";

export const MIN_COMFY_VERSION = [0, 46, 2] as const;
export const POST_WINDOW_MS = 30_000;
export const RUN_TIMEOUT_MS = 15 * 60_000;
const MAX_LOSSES = 3;
const MAX_SERVER_ERRORS = 3;
const TICK_MS = 2000;
const SWEEP_MS = 10 * 60_000;

export interface Faults {
  afterFirstFile?(): void;
  afterRename?(): void;
  afterDone?(): void;
}

export interface TrackerOptions {
  store: Store;
  config: Config;
  comfy: ComfyClient;
  now?: () => number;
  faults?: Faults;
}

export function compatible(version: string | null): boolean {
  if (!version) return false;
  const parts = version.split(/[.+-]/).slice(0, 3).map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < 3; i++) {
    const have = parts[i] ?? 0;
    const want = MIN_COMFY_VERSION[i] ?? 0;
    if (Number.isNaN(have)) return false;
    if (have !== want) return have > want;
  }
  return true;
}

class OutputsMissing extends Error {}

export class Tracker implements TrackerView {
  private readonly store: Store;
  private readonly config: Config;
  private readonly comfy: ComfyClient;
  private readonly now: () => number;
  private readonly faults: Faults;
  private state: ComfyState = "offline";
  private version: string | null = null;
  private snapshot: QueueSnapshot | null = null;
  private backoffMs = 0;
  private nextAttemptAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(opts: TrackerOptions) {
    this.store = opts.store;
    this.config = opts.config;
    this.comfy = opts.comfy;
    this.now = opts.now ?? Date.now;
    this.faults = opts.faults ?? {};
  }

  health(): { comfyui: ComfyState; version: string | null } {
    return { comfyui: this.state, version: this.version };
  }

  /**
   * A small source image for an unfinished job: an image job's upload, or the 256-pixel thumbnail a prompt
   * job's graph writes, counted ready once its size held on two consecutive ticks (never half written).
   */
  sourcePreview(job: JobRow): string | null {
    if (job.state !== "pending" && job.state !== "submitted") return null;
    if (job.kind === "image") {
      const upload = uploadPath(this.config, job);
      return existsSync(upload) ? upload : null;
    }
    const seen = this.thumbs.get(job.id);
    return seen && seen.stable && seen.attempt === job.prompt_id ? seen.path : null;
  }

  private readonly thumbs = new Map<string, { attempt: string; path: string; size: number; stable: boolean }>();

  /** Records each running prompt job's thumbnail size; called on every tick. */
  private watchThumbnails(): void {
    const live = new Set<string>();
    for (const job of this.jobs("state = 'submitted' AND kind = 'prompt' AND prompt_id IS NOT NULL")) {
      live.add(job.id);
      const dir = join(this.config.comfyOutputDir, job.id, job.prompt_id ?? "");
      const name = existsSync(dir) ? readdirSync(dir).filter((n) => /^thumb_\d+_\.png$/.test(n)).sort()[0] : undefined;
      if (!name) {
        this.thumbs.delete(job.id);
        continue;
      }
      const path = join(dir, name);
      const size = statSync(path).size;
      const before = this.thumbs.get(job.id);
      const stable = before?.attempt === job.prompt_id && before.path === path && before.size === size && size > 0;
      this.thumbs.set(job.id, { attempt: job.prompt_id ?? "", path, size, stable });
    }
    for (const id of this.thumbs.keys()) if (!live.has(id)) this.thumbs.delete(id);
  }

  queueInfo(promptId: string | null): QueueInfo | null {
    if (!promptId || !this.snapshot) return null;
    if (this.snapshot.running.includes(promptId)) return { running: true, position: null };
    const i = this.snapshot.pending.indexOf(promptId);
    return i >= 0 ? { running: false, position: i + 1 } : null;
  }

  start(): void {
    this.sweep({ atStart: true });
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.tick()
        .catch((e: unknown) => {
          console.error(`✗ Failed: tracker tick: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          this.inFlight = null;
        });
    }, TICK_MS);
    this.sweepTimer = setInterval(() => {
      if (!this.inFlight) this.sweep();
    }, SWEEP_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.timer = null;
    this.sweepTimer = null;
    await this.inFlight;
  }

  // ---- one tick -------------------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.state === "offline" && this.now() < this.nextAttemptAt) return;
    let version: string | null;
    try {
      version = await this.comfy.version();
    } catch (e) {
      if (e instanceof ComfyError && e.kind !== "rejected") {
        this.wentOffline();
        return;
      }
      throw e;
    }
    this.backoffMs = 0;
    this.version = version;
    if (!compatible(version)) {
      this.state = "incompatible";
      return;
    }
    this.state = "reachable";
    try {
      this.snapshot = await this.comfy.queue();
      this.flagHunyuan();
      await this.handleCancels();
      this.removeHunyuan();
      await this.submitPending();
      this.snapshot = await this.comfy.queue();
      await this.reconcile();
      this.watchThumbnails();
      await this.timeouts();
    } catch (e) {
      if (e instanceof ComfyError && e.kind === "unreachable") {
        this.wentOffline();
        return;
      }
      throw e;
    }
  }

  private wentOffline(): void {
    this.state = "offline";
    this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : TICK_MS, 60_000);
    this.nextAttemptAt = this.now() + this.backoffMs;
  }

  private jobs(where: string, ...args: (string | number)[]): JobRow[] {
    return this.store.db.query(`SELECT * FROM jobs WHERE ${where} ORDER BY created_at, position`).all(...args) as JobRow[];
  }

  private inQueue(promptId: string): boolean {
    return !!this.snapshot && (this.snapshot.running.includes(promptId) || this.snapshot.pending.includes(promptId));
  }

  private update(id: string, expectState: string, set: string, args: (string | number | null)[] = []): boolean {
    return this.store.db.run(`UPDATE jobs SET ${set} WHERE id = ? AND state = ?`, [...args, id, expectState]).changes === 1;
  }

  private markCancelled(job: JobRow): void {
    this.update(job.id, job.state, "state = 'cancelled', cancel_requested = 0, finished_at = ?", [this.now()]);
  }

  private markFailed(job: JobRow, message: string): void {
    this.update(job.id, job.state, "state = 'failed', cancel_requested = 0, error = ?, finished_at = ?", [message, this.now()]);
  }

  /** A finished attempt's outcome: collect a success, record an error. Returns false when not finished. */
  private async settle(job: JobRow, entry: HistoryEntry | null): Promise<boolean> {
    if (!entry) return false;
    if (entry.status === "success") {
      try {
        await this.collect(job, entry);
      } catch (e) {
        if (e instanceof OutputsMissing) this.lose(job);
        else throw e;
      }
    } else {
      this.markFailed(job, entry.message ?? "ComfyUI reported an error.");
    }
    return true;
  }

  // Step 1: cancel requests.
  private async handleCancels(): Promise<void> {
    for (const job of this.jobs("cancel_requested = 1 AND state IN ('pending', 'submitted')")) {
      if (job.state === "pending" && !job.prompt_id) {
        this.markCancelled(job);
        continue;
      }
      const promptId = job.prompt_id ?? "";
      const entry = await this.comfy.history(promptId);
      if (await this.settle(job, entry)) continue;
      const known = this.inQueue(promptId);
      if (job.state === "pending" && !known && job.posted_at !== null && this.now() - job.posted_at < POST_WINDOW_MS) continue;
      let cancelled: boolean;
      try {
        cancelled = await this.comfy.cancel(promptId);
      } catch (e) {
        if (e instanceof ComfyError && e.kind !== "unreachable") continue;
        throw e;
      }
      if (cancelled || !known) {
        this.markCancelled(job);
        continue;
      }
      if (!(await this.settle(job, await this.comfy.history(promptId)))) this.markCancelled(job);
    }
  }

  // Step 2: submission.
  // Hunyuan3D removal (Design, Restart, upgrade and rollback): unfinished Hunyuan3D jobs get the cancel flag
  // before step 1 handles cancels, and finished ones go through the delete path before step 2 submits.
  private flagHunyuan(): void {
    this.store.db.run("UPDATE jobs SET cancel_requested = 1 WHERE engine = 'hunyuan' AND state IN ('pending', 'submitted') AND cancel_requested = 0");
  }

  private removeHunyuan(): void {
    for (const job of this.jobs("engine = 'hunyuan' AND state IN ('done', 'failed', 'cancelled')")) {
      void deleteJob(this.store, this.config, job.id);
    }
  }

  private async submitPending(): Promise<void> {
    for (const row of this.jobs("state = 'pending' AND cancel_requested = 0 AND engine = 'trellis'")) {
      let job = row;
      if (!job.prompt_id) {
        const attempt = crypto.randomUUID();
        if (!this.update(job.id, "pending", "prompt_id = ?, posted_at = NULL", [attempt])) continue;
        job = { ...job, prompt_id: attempt, posted_at: null };
      }
      const promptId = job.prompt_id ?? "";
      if (this.inQueue(promptId) || (await this.comfy.history(promptId))) {
        this.update(job.id, "pending", "state = 'submitted'");
        continue;
      }
      if (job.posted_at !== null && this.now() - job.posted_at < POST_WINDOW_MS) continue;
      try {
        if (job.kind === "image") {
          await this.comfy.upload(uploadPath(this.config, job), `${job.id}.${job.upload_ext ?? "png"}`, MIME[job.upload_ext ?? "png"] ?? "image/png");
        }
        if (!this.update(job.id, "pending", "posted_at = ?", [this.now()])) continue;
        await this.comfy.postPrompt(this.graphFor(job), promptId);
        this.update(job.id, "pending", "state = 'submitted', server_errors = 0");
      } catch (e) {
        if (!(e instanceof ComfyError)) throw e;
        if (e.kind === "unreachable") return;
        if (e.kind === "rejected") {
          this.markFailed(job, e.message);
          continue;
        }
        const errors = job.server_errors + 1;
        if (errors >= MAX_SERVER_ERRORS) this.markFailed(job, e.message);
        else this.update(job.id, "pending", "server_errors = ?, posted_at = NULL", [errors]);
      }
    }
  }

  private graphFor(job: JobRow): Record<string, unknown> {
    // Only TRELLIS.2 jobs reach this point; Hunyuan3D rows are cancelled and deleted instead (Design).
    const common = { seed: job.seed, faces: job.faces, tex: job.tex ?? 2048 };
    const input: JobGraphInput = job.kind === "prompt"
      ? { ...common, kind: "prompt", prompt: job.prompt ?? "", style: job.style === 1, sharedStyle: job.shared_style }
      : { ...common, kind: "image", upload: `asset-studio/${job.id}.${job.upload_ext ?? "png"}` };
    return combineGraph(input, `asset-studio/${job.id}/${job.prompt_id ?? ""}`);
  }

  // Step 3 to 5: reconciliation.
  private async reconcile(): Promise<void> {
    for (const job of this.jobs("state = 'submitted'")) {
      const promptId = job.prompt_id ?? "";
      if (this.snapshot?.running.includes(promptId) && job.started_at === null) {
        this.update(job.id, "submitted", "started_at = ?", [this.now()]);
      }
      if (await this.settle(job, await this.comfy.history(promptId))) continue;
      if (this.inQueue(promptId)) continue;
      this.lose(job);
    }
  }

  private lose(job: JobRow): void {
    const losses = job.losses + 1;
    if (losses >= MAX_LOSSES) {
      this.update(job.id, job.state, "state = 'failed', losses = ?, error = ?, finished_at = ?", [losses, `ComfyUI lost this job ${String(losses)} times.`, this.now()]);
      return;
    }
    this.update(job.id, job.state,
      // A resubmission is a new attempt, so its queued time restarts like a retry's.
      "state = 'pending', prompt_id = NULL, posted_at = NULL, started_at = NULL, finished_at = NULL, error = NULL, server_errors = 0, losses = ?, queued_at = ?",
      [losses, this.now()]);
  }

  // Step 6: timeouts.
  private async timeouts(): Promise<void> {
    const cutoff = this.now() - RUN_TIMEOUT_MS;
    for (const job of this.jobs("state = 'submitted' AND fixture = 0 AND started_at IS NOT NULL AND started_at < ?", cutoff)) {
      const promptId = job.prompt_id ?? "";
      let cancelled: boolean;
      try {
        cancelled = await this.comfy.cancel(promptId);
      } catch (e) {
        if (e instanceof ComfyError && e.kind !== "unreachable") continue;
        throw e;
      }
      if (cancelled) {
        this.markFailed(job, "Stopped after running longer than 15 minutes.");
        continue;
      }
      if (!(await this.settle(job, await this.comfy.history(promptId)))) this.markFailed(job, "Stopped after running longer than 15 minutes.");
    }
  }

  // ---- collection -----------------------------------------------------------------------------------

  private async collect(job: JobRow, entry: HistoryEntry): Promise<void> {
    const finalDir = assetDir(this.config, job.id);
    if (!completeAsset(this.config, job.id)) {
      rmSync(finalDir, { recursive: true, force: true });
      const assets = join(this.config.dataDir, "assets");
      mkdirSync(assets, { recursive: true });
      for (const name of readdirSync(assets)) {
        if (name.startsWith(`.collect-${job.id}-`)) rmSync(join(assets, name), { recursive: true, force: true });
      }
      const attempt = job.prompt_id ?? "";
      const work = join(assets, `.collect-${job.id}-${attempt}`);
      mkdirSync(work, { recursive: true });
      const jobFolder = `asset-studio/${job.id}`;
      const glb = entry.files.find((f) => f.filename.endsWith(".glb") && f.subfolder === jobFolder);
      const thumb = entry.files.find((f) => f.subfolder === `${jobFolder}/${attempt}` && f.filename.startsWith("thumb"));
      const source = entry.files.find((f) => f.subfolder === jobFolder && f.filename.startsWith(attempt) && f.filename.endsWith(".png"));
      const wanted: [string, (typeof entry.files)[number] | undefined][] = [["model.glb", glb], ["thumb.png", thumb]];
      if (job.kind === "prompt") wanted.push(["source.png", source]);
      let first = true;
      for (const [name, file] of wanted) {
        if (!file) throw new OutputsMissing(`ComfyUI history has no ${name} for ${job.id}`);
        const bytes = await this.comfy.view(file);
        if (!bytes) throw new OutputsMissing(`ComfyUI no longer has ${file.filename}`);
        writeFileSync(join(work, name), bytes);
        if (first) {
          first = false;
          this.faults.afterFirstFile?.();
        }
      }
      if (job.kind === "image") copyFileSync(uploadPath(this.config, job), join(work, `source.${job.upload_ext ?? "png"}`));
      renameSync(work, finalDir);
      this.faults.afterRename?.();
    }
    this.update(job.id, job.state, "state = 'done', cancel_requested = 0, error = NULL, finished_at = ?", [this.now()]);
    this.faults.afterDone?.();
    removeComfyFiles(this.config, job.id);
  }

  // ---- sweep ----------------------------------------------------------------------------------------

  /** Removes leftovers: the app's files in ComfyUI's folders, orphaned uploads, staging and collection directories. */
  sweep(opts: { atStart?: boolean } = {}): void {
    const stateOf = this.store.db.prepare("SELECT state, prompt_id FROM jobs WHERE id = ?");
    const removable = (jobId: string): boolean => {
      const row = stateOf.get(jobId) as { state: string; prompt_id: string | null } | null;
      if (!row || row.state === "done") return true;
      if (row.state === "failed" || row.state === "cancelled") return !!this.snapshot && !this.inQueue(row.prompt_id ?? "");
      return false;
    };
    if (existsSync(this.config.comfyOutputDir)) {
      for (const name of readdirSync(this.config.comfyOutputDir)) {
        if (removable(name)) rmSync(join(this.config.comfyOutputDir, name), { recursive: true, force: true });
      }
    }
    if (existsSync(this.config.comfyInputDir)) {
      for (const name of readdirSync(this.config.comfyInputDir)) {
        const jobId = name.replace(/\.[^.]+$/, "");
        if (removable(jobId)) rmSync(join(this.config.comfyInputDir, name), { force: true });
      }
    }
    const uploads = join(this.config.dataDir, "uploads");
    if (existsSync(uploads)) {
      this.store.db.transaction(() => {
        const hasBatch = this.store.db.prepare("SELECT 1 FROM batches WHERE id = ?");
        for (const name of readdirSync(uploads)) {
          if (!hasBatch.get(name)) rmSync(join(uploads, name), { recursive: true, force: true });
        }
      }).immediate();
    }
    const staging = join(this.config.dataDir, "staging");
    if (existsSync(staging)) {
      const cutoff = Date.now() - 3600_000;
      for (const name of readdirSync(staging)) {
        const path = join(staging, name);
        if (opts.atStart || statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
      }
    }
    const assets = join(this.config.dataDir, "assets");
    if (existsSync(assets)) {
      for (const name of readdirSync(assets)) {
        if (name.startsWith(".collect-")) rmSync(join(assets, name), { recursive: true, force: true });
      }
    }
  }
}
