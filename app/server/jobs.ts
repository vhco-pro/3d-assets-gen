// Job rows, their API view, listing, cancel requests and retries.
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";

export type JobState = "pending" | "submitted" | "done" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  batch_id: string;
  position: number;
  kind: "prompt" | "image";
  prompt: string | null;
  upload_name: string | null;
  upload_ext: string | null;
  engine: "trellis" | "hunyuan";
  faces: number;
  tex: number | null;
  style: number;
  seed: number;
  state: JobState;
  prompt_id: string | null;
  posted_at: number | null;
  attempts: number;
  losses: number;
  server_errors: number;
  cancel_requested: number;
  fixture: number;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

/** Queue information for a submitted job, from the tracker's latest /queue snapshot. */
export interface QueueInfo {
  running: boolean;
  position: number | null;
}

export interface JobView {
  id: string;
  batchId: string;
  position: number;
  kind: "prompt" | "image";
  prompt: string | null;
  upload: string | null;
  engine: string;
  faces: number;
  tex: number | null;
  style: boolean;
  seed: number;
  state: JobState;
  running: boolean;
  queuePosition: number | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export function jobView(row: JobRow, queue: QueueInfo | null): JobView {
  return {
    id: row.id,
    batchId: row.batch_id,
    position: row.position,
    kind: row.kind,
    prompt: row.prompt,
    upload: row.upload_name,
    engine: row.engine,
    faces: row.faces,
    tex: row.tex,
    style: row.style === 1,
    seed: row.seed,
    state: row.state,
    running: queue?.running ?? false,
    queuePosition: queue?.position ?? null,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export type QueueLookup = (promptId: string | null) => QueueInfo | null;

export function listJobs(store: Store, filter: { state?: string | null; batch?: string | null }, queue: QueueLookup): JobView[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.state) {
    where.push("j.state = ?");
    args.push(filter.state);
  }
  if (filter.batch) {
    where.push("j.batch_id = ?");
    args.push(filter.batch);
  }
  const sql = `SELECT j.* FROM jobs j JOIN batches b ON b.id = j.batch_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY b.created_at DESC, b.id DESC, j.position ASC`;
  return (store.db.query(sql).all(...args) as JobRow[]).map((r) => jobView(r, r.state === "submitted" ? queue(r.prompt_id) : null));
}

export function getJob(store: Store, id: string): JobRow | null {
  return store.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
}

export type ActionResult = { ok: true } | { ok: false; status: number; error: string };

export function requestCancel(store: Store, id: string): ActionResult {
  const job = getJob(store, id);
  if (!job) return { ok: false, status: 404, error: "No such job." };
  const res = store.db.run("UPDATE jobs SET cancel_requested = 1 WHERE id = ? AND state IN ('pending', 'submitted')", [id]);
  return res.changes === 1 ? { ok: true } : { ok: false, status: 409, error: "Only waiting, queued or generating jobs can be cancelled." };
}

export function retryJob(store: Store, config: Config, id: string): ActionResult {
  return store.db.transaction((): ActionResult => {
    const job = getJob(store, id);
    if (!job) return { ok: false, status: 404, error: "No such job." };
    if (job.state !== "failed" && job.state !== "cancelled") return { ok: false, status: 409, error: "Only failed or cancelled jobs can be retried." };
    const unfinished = (store.db.query("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('pending', 'submitted')").get() as { n: number }).n;
    if (unfinished + 1 > config.limits.unfinishedJobs) {
      return { ok: false, status: 409, error: `There can be at most ${String(config.limits.unfinishedJobs)} unfinished jobs; wait for some to finish before retrying.` };
    }
    store.db.run(
      `UPDATE jobs SET state = 'pending', prompt_id = NULL, posted_at = NULL, losses = 0, server_errors = 0, cancel_requested = 0,
        started_at = NULL, finished_at = NULL, error = NULL, attempts = attempts + 1 WHERE id = ? AND state = ?`,
      [id, job.state],
    );
    return { ok: true };
  }).immediate();
}
