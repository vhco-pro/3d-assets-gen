// Preset fields the page offers and how a batch expands into jobs. Shared by the page and the server,
// so it uses only web-standard APIs.

export const DETAILS = [5000, 10000, 20000] as const;
export const TEXTURES = [1024, 2048] as const;
export const MAX_VARIANTS = 4;
export const MAX_SEED = 4294967295;
export const IMAGE_SIZE = 1024;

/** Every job's mesh comes from TRELLIS.2; the batch API keeps no engine field (Design, Jobs and batches). */
export interface Presets {
  faces: (typeof DETAILS)[number];
  tex: (typeof TEXTURES)[number];
  variants: number;
  style: boolean;
  /** Seed of the first variant, or null for a random seed per prompt line or image. */
  seed: number | null;
}

export const DEFAULT_PRESETS: Presets = { faces: 10000, tex: 2048, variants: 1, style: true, seed: null };
export const MAX_PROMPT_CHARS = 2000;

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 0;
}

/** Seed of variant k (counted from 0) of a line whose first seed is `base`. */
export function variantSeed(base: number, k: number): number {
  return (base + k) % (MAX_SEED + 1);
}

export interface PlannedJob {
  /** Position in the batch: prompt line index then variant, or image index. */
  position: number;
  line: number;
  variant: number;
  seed: number;
}

/**
 * Expands a batch of `lines` prompt lines (or images) into jobs. Prompt lines get `variants` jobs each;
 * image batches always get one job per image. One random seed is drawn per line when no seed is given.
 */
export function planJobs(lines: number, presets: Presets, kind: "prompt" | "image", draw: () => number = randomSeed): PlannedJob[] {
  const variants = kind === "prompt" ? presets.variants : 1;
  const jobs: PlannedJob[] = [];
  for (let line = 0; line < lines; line++) {
    const base = presets.seed ?? draw();
    for (let variant = 0; variant < variants; variant++) {
      jobs.push({ position: jobs.length, line, variant, seed: variantSeed(base, variant) });
    }
  }
  return jobs;
}
