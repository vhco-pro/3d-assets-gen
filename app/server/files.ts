// Where job files live: the data directory's assets and uploads, and the app's own files in ComfyUI's folders.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { JobRow } from "./jobs.ts";

export const ASSET_FILES = ["model.glb", "source", "thumb.png"] as const;
export const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function assetDir(config: Config, jobId: string): string {
  return join(config.dataDir, "assets", jobId);
}

export function uploadPath(config: Config, job: Pick<JobRow, "batch_id" | "position" | "upload_ext">): string {
  return join(config.dataDir, "uploads", job.batch_id, `${String(job.position)}.${job.upload_ext ?? "png"}`);
}

/** The finished asset's files, or null when the asset directory is not complete. */
export function completeAsset(config: Config, jobId: string): { glb: string; source: string; thumb: string } | null {
  const dir = assetDir(config, jobId);
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  const source = names.find((n) => n.startsWith("source."));
  if (!names.includes("model.glb") || !names.includes("thumb.png") || !source) return null;
  return { glb: join(dir, "model.glb"), source: join(dir, source), thumb: join(dir, "thumb.png") };
}

/** Deletes the job's output directory and upload in ComfyUI's asset-studio folders. */
export function removeComfyFiles(config: Config, jobId: string): void {
  rmSync(join(config.comfyOutputDir, jobId), { recursive: true, force: true });
  if (existsSync(config.comfyInputDir)) {
    for (const name of readdirSync(config.comfyInputDir)) {
      if (name.startsWith(`${jobId}.`)) rmSync(join(config.comfyInputDir, name), { force: true });
    }
  }
}
