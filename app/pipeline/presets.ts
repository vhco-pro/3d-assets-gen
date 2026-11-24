// Preset fields the page offers and how a batch expands into jobs. Shared by the page and the server,
// so it uses only web-standard APIs.

export const DETAILS = [5000, 10000, 20000, 30000] as const;
export const TEXTURES = [1024, 2048, 4096] as const;
/** Ultra is exactly this pair; the batch API refuses 30000 or 4096 in any other pairing. */
export const ULTRA_FACES = 30000;
export const ULTRA_TEX = 4096;
export const ULTRA_MESSAGE = "Ultra uses 30k triangles with 4096 textures.";
export const isUltra = (faces: number, tex: number | null): boolean => faces === ULTRA_FACES && tex === ULTRA_TEX;
/** A valid Detail and Texture pairing: Ultra's pair, or neither half of it. */
export const validPairing = (faces: number, tex: number): boolean => isUltra(faces, tex) || (faces !== ULTRA_FACES && tex !== ULTRA_TEX);

/** The four Quality levels the page offers, each a valid pairing of the values above (Design > Quality). */
export const QUALITIES = [
  { name: "Fast", faces: 5000, tex: 1024 },
  { name: "Standard", faces: 10000, tex: 2048 },
  { name: "High", faces: 20000, tex: 2048 },
  { name: "Ultra", faces: 30000, tex: 4096 },
] as const;
export type QualityName = (typeof QUALITIES)[number]["name"];
export const DEFAULT_QUALITY: QualityName = "Standard";

export function qualityByName(name: QualityName): (typeof QUALITIES)[number] {
  return QUALITIES.find((q) => q.name === name) ?? QUALITIES[1];
}

/** The level a pair matches, or null for an older job whose pair matches none. */
export function qualityOf(faces: number, tex: number | null): QualityName | null {
  return QUALITIES.find((q) => q.faces === faces && q.tex === tex)?.name ?? null;
}

/** What the page shows for a job's settings: the level's name, or `Custom (<k>k, <texture>)`. */
export function qualityLabel(faces: number, tex: number | null): string {
  const name = qualityOf(faces, tex);
  if (name) return name;
  const k = `${String(faces / 1000)}k`;
  return tex === null ? `Custom (${k})` : `Custom (${k}, ${String(tex)})`;
}

/** The level Remix selects: the matching level, else the one with the same triangle count, else Standard. */
export function remixQuality(faces: number, tex: number | null): QualityName {
  return qualityOf(faces, tex) ?? QUALITIES.find((q) => q.faces === faces)?.name ?? DEFAULT_QUALITY;
}

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
  /** Art-direction text joined to every prompt line; null for none. Prompt batches only. */
  sharedStyle: string | null;
}

export const DEFAULT_PRESETS: Presets = { faces: 10000, tex: 2048, variants: 1, style: true, seed: null, sharedStyle: null };
export const MAX_SHARED_STYLE_CHARS = 300;
export const DEFAULT_SHARED_STYLE = "stylized hand-painted game art, clean readable silhouette, consistent muted color palette";
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
