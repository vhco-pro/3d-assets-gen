import { expect, test } from "bun:test";
import { DEFAULT_PRESETS, MAX_SEED, planJobs } from "./presets.ts";

test("one random seed per prompt line, variant k uses seed + k modulo 2^32", () => {
  const draws = [10, MAX_SEED];
  const jobs = planJobs(2, { ...DEFAULT_PRESETS, variants: 3 }, "prompt", () => draws.shift() ?? 0);
  expect(jobs.map((j) => [j.position, j.line, j.variant, j.seed])).toEqual([
    [0, 0, 0, 10], [1, 0, 1, 11], [2, 0, 2, 12],
    [3, 1, 0, MAX_SEED], [4, 1, 1, 0], [5, 1, 2, 1],
  ]);
});

test("a given seed applies to every line; image batches ignore variants", () => {
  const jobs = planJobs(2, { ...DEFAULT_PRESETS, variants: 4, seed: 7 }, "image", () => 99);
  expect(jobs.map((j) => j.seed)).toEqual([7, 7]);
});
