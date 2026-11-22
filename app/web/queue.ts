// Queue times and estimates (feature document, Design > Page). Pure functions over the job list, so the
// page recomputes them on every refresh and the rules are unit tested.

export interface QueueJob {
  id: string;
  state: "pending" | "submitted" | "done" | "failed" | "cancelled";
  running: boolean;
  queuePosition: number | null;
  faces: number;
  tex: number | null;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const SAMPLE = 20;
const MIN_MATCHES = 3;
const PROGRESS_CAP = 0.95;

/** `45 s`, `6 min 40 s`, `6 min`, `1 h 5 min`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${String(total)} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const seconds = total % 60;
    return seconds === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(seconds)} s`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * The typical generation time for a Detail and Texture: the median of the last 20 matching done jobs whose
 * start the app saw, or of the last 20 such done jobs of any setting when fewer than three match; null
 * when there are none.
 */
export function typicalDuration(jobs: QueueJob[], faces: number, tex: number | null): number | null {
  const timed = jobs
    .filter((j): j is QueueJob & { startedAt: number; finishedAt: number } => j.state === "done" && j.startedAt !== null && j.finishedAt !== null)
    .sort((a, b) => b.finishedAt - a.finishedAt);
  const matching = timed.filter((j) => j.faces === faces && j.tex === tex);
  const pool = (matching.length >= MIN_MATCHES ? matching : timed).slice(0, SAMPLE);
  return pool.length === 0 ? null : median(pool.map((j) => j.finishedAt - j.startedAt));
}

export interface JobEstimate {
  /** Typical generation time for this job's settings, or null. */
  typical: number | null;
  /** Waiting and Queued jobs: time until this job is expected to start, or null when it cannot be estimated. */
  startsIn: number | null;
  /** Generating jobs: elapsed over typical time, capped at 95 percent. */
  progress: number | null;
  /** Generating jobs: typical time left, zero once past it. */
  left: number | null;
  /** Generating jobs: running longer than the typical time. */
  overTypical: boolean;
}

const sum = (values: (number | null)[]): number | null => (values.some((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));

/**
 * Per-job estimates and the queue-clear time. The running app job counts with its remaining typical time
 * (zero past it); prompts from outside the app are not known, so they are not counted.
 */
export function estimates(jobs: QueueJob[], now: number): { jobs: Map<string, JobEstimate>; queueClear: number | null } {
  const typicalOf = (j: QueueJob): number | null => typicalDuration(jobs, j.faces, j.tex);
  const running = jobs.find((j) => j.state === "submitted" && j.running);
  const runningTypical = running ? typicalOf(running) : 0;
  const elapsedOf = (j: QueueJob): number => (j.startedAt === null ? 0 : Math.max(0, now - j.startedAt));
  const remainder = running ? (runningTypical === null ? null : Math.max(0, runningTypical - elapsedOf(running))) : 0;
  const queued = jobs.filter((j) => j.state === "submitted" && !j.running).sort((a, b) => (a.queuePosition ?? Infinity) - (b.queuePosition ?? Infinity));
  const waiting = jobs.filter((j) => j.state === "pending").sort((a, b) => a.queuedAt - b.queuedAt);
  const out = new Map<string, JobEstimate>();
  for (const j of jobs) {
    const typical = typicalOf(j);
    const base: JobEstimate = { typical, startsIn: null, progress: null, left: null, overTypical: false };
    if (j.state === "submitted" && j.running) {
      if (typical !== null) {
        const elapsed = elapsedOf(j);
        base.progress = Math.min(PROGRESS_CAP, elapsed / typical);
        base.left = Math.max(0, typical - elapsed);
        base.overTypical = elapsed > typical;
      }
    } else if (j.state === "submitted") {
      const ahead = queued.filter((q) => q.id !== j.id && (q.queuePosition ?? Infinity) < (j.queuePosition ?? Infinity));
      base.startsIn = sum([remainder, ...ahead.map(typicalOf)]);
    } else if (j.state === "pending") {
      const earlier = waiting.slice(0, waiting.findIndex((w) => w.id === j.id));
      base.startsIn = sum([remainder, ...queued.map(typicalOf), ...earlier.map(typicalOf)]);
    }
    out.set(j.id, base);
  }
  const others = [...queued, ...waiting];
  const queueClear = running || others.length > 0 ? sum([remainder, ...others.map(typicalOf)]) : null;
  return { jobs: out, queueClear };
}
