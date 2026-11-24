import { expect, test } from "bun:test";
import { DEFAULT_PRESETS, MAX_SEED, planJobs, QUALITIES, qualityLabel, remixQuality, validPairing } from "./presets.ts";

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

test("every Quality level maps to the table's pair and is a valid pairing", () => {
  expect(QUALITIES.map((q) => [q.name, q.faces, q.tex])).toEqual([
    ["Fast", 5000, 1024],
    ["Standard", 10000, 2048],
    ["High", 20000, 2048],
    ["Ultra", 30000, 4096],
  ]);
  for (const q of QUALITIES) expect(validPairing(q.faces, q.tex)).toBe(true);
});

test("the Quality label names a level, or Custom with the triangles and texture", () => {
  expect(QUALITIES.map((q) => qualityLabel(q.faces, q.tex))).toEqual(["Fast", "Standard", "High", "Ultra"]);
  expect(qualityLabel(5000, 2048)).toBe("Custom (5k, 2048)");
  expect(qualityLabel(10000, null)).toBe("Custom (10k)");
});

test("Remix picks the level with the same triangle count, otherwise Standard", () => {
  expect(remixQuality(5000, 2048)).toBe("Fast");
  expect(remixQuality(10000, null)).toBe("Standard");
  expect(remixQuality(20000, 4096)).toBe("High");
  expect(remixQuality(15000, 2048)).toBe("Standard");
});
