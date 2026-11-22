import { describe, expect, test } from "bun:test";
import { estimates, formatDuration, typicalDuration, type QueueJob } from "./queue.ts";

const S = 1000;
const MIN = 60 * S;
const NOW = 1_800_000_000_000;
let seq = 0;
function job(p: Partial<QueueJob>): QueueJob {
  seq += 1;
  return { id: `j${String(seq)}`, state: "done", running: false, queuePosition: null, faces: 10000, tex: 2048, queuedAt: NOW - 60 * MIN, startedAt: null, finishedAt: null, ...p };
}
const doneIn = (ms: number, finishedAgo: number, p: Partial<QueueJob> = {}): QueueJob => job({ state: "done", startedAt: NOW - finishedAgo - ms, finishedAt: NOW - finishedAgo, ...p });

describe("formatDuration", () => {
  test("seconds, minutes and hours", () => {
    expect(formatDuration(45 * S)).toBe("45 s");
    expect(formatDuration(400 * S)).toBe("6 min 40 s");
    expect(formatDuration(6 * MIN)).toBe("6 min");
    expect(formatDuration(65 * MIN)).toBe("1 h 5 min");
    expect(formatDuration(0)).toBe("0 s");
  });
});

describe("typicalDuration", () => {
  test("the median over the last 20 matching done jobs", () => {
    const jobs = [doneIn(300 * S, 1 * MIN), doneIn(400 * S, 2 * MIN), doneIn(500 * S, 3 * MIN), doneIn(900 * S, 4 * MIN, { faces: 20000 })];
    expect(typicalDuration(jobs, 10000, 2048)).toBe(400 * S);
  });
  test("only the 20 most recent matching jobs count", () => {
    const recent = Array.from({ length: 20 }, (_, i) => doneIn(100 * S, i * MIN));
    const old = Array.from({ length: 10 }, (_, i) => doneIn(900 * S, (100 + i) * MIN));
    expect(typicalDuration([...old, ...recent], 10000, 2048)).toBe(100 * S);
  });
  test("falls back to any setting below three matches, and is null without done jobs", () => {
    const jobs = [doneIn(300 * S, 1 * MIN), doneIn(600 * S, 2 * MIN, { faces: 20000 }), doneIn(900 * S, 3 * MIN, { tex: 1024 })];
    expect(typicalDuration(jobs, 5000, 1024)).toBe(600 * S);
    expect(typicalDuration([], 10000, 2048)).toBeNull();
  });
  test("jobs whose start was never seen are left out", () => {
    const jobs = [doneIn(300 * S, 1 * MIN), doneIn(300 * S, 2 * MIN), doneIn(300 * S, 3 * MIN), job({ state: "done", startedAt: null, finishedAt: NOW - MIN })];
    expect(typicalDuration(jobs, 10000, 2048)).toBe(300 * S);
  });
});

describe("estimates", () => {
  const history = [doneIn(400 * S, 10 * MIN), doneIn(400 * S, 20 * MIN), doneIn(400 * S, 30 * MIN)];
  test("a Generating job: progress capped at 95 percent, time left, and over typical", () => {
    const g = job({ state: "submitted", running: true, startedAt: NOW - 100 * S });
    const e = estimates([...history, g], NOW);
    expect(e.jobs.get(g.id)).toMatchObject({ progress: 0.25, left: 300 * S, overTypical: false });
    const late = job({ state: "submitted", running: true, startedAt: NOW - 500 * S });
    const e2 = estimates([...history, late], NOW);
    expect(e2.jobs.get(late.id)).toMatchObject({ progress: 0.95, left: 0, overTypical: true });
  });
  test("a Queued job starts after the running remainder and the queued jobs ahead of it", () => {
    const g = job({ state: "submitted", running: true, startedAt: NOW - 100 * S });
    const q1 = job({ state: "submitted", queuePosition: 1 });
    const q2 = job({ state: "submitted", queuePosition: 2 });
    const e = estimates([...history, g, q1, q2], NOW);
    expect(e.jobs.get(q1.id)?.startsIn).toBe(300 * S);
    expect(e.jobs.get(q2.id)?.startsIn).toBe(700 * S);
  });
  test("the running remainder is clamped at zero past the typical time", () => {
    const g = job({ state: "submitted", running: true, startedAt: NOW - 900 * S });
    const q = job({ state: "submitted", queuePosition: 1 });
    expect(estimates([...history, g, q], NOW).jobs.get(q.id)?.startsIn).toBe(0);
  });
  test("a Waiting job counts the running remainder once, every queued job and earlier Waiting jobs", () => {
    const g = job({ state: "submitted", running: true, startedAt: NOW - 100 * S });
    const q = job({ state: "submitted", queuePosition: 1 });
    const w1 = job({ state: "pending", queuedAt: NOW - 2 * MIN });
    const w2 = job({ state: "pending", queuedAt: NOW - 1 * MIN });
    const e = estimates([...history, g, q, w1, w2], NOW);
    expect(e.jobs.get(w1.id)?.startsIn).toBe(300 * S + 400 * S);
    expect(e.jobs.get(w2.id)?.startsIn).toBe(300 * S + 400 * S + 400 * S);
  });
  test("queue clear is the running remainder plus every other unfinished job, and hidden without a typical time", () => {
    const g = job({ state: "submitted", running: true, startedAt: NOW - 100 * S });
    const q = job({ state: "submitted", queuePosition: 1 });
    const w = job({ state: "pending" });
    expect(estimates([...history, g, q, w], NOW).queueClear).toBe(300 * S + 800 * S);
    expect(estimates([g, q, w], NOW).queueClear).toBeNull();
    expect(estimates([...history], NOW).queueClear).toBeNull();
  });
});
