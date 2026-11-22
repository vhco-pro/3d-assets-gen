// Single-asset downloads and job deletion.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { completeAsset, removeComfyFiles, assetDir } from "./files.ts";
import { getJob, type JobRow } from "./jobs.ts";
import type { Store } from "./store.ts";

export function slugFor(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return slug || "asset";
}

export function baseName(job: Pick<JobRow, "id" | "kind" | "prompt" | "upload_name">): string {
  const text = job.kind === "prompt" ? (job.prompt ?? "") : (job.upload_name ?? "").replace(/\.[^.]*$/, "");
  return `${slugFor(text)}-${job.id.slice(0, 8)}`;
}

const CONTENT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function downloadAsset(store: Store, config: Config, id: string, what: string): Response {
  const job = getJob(store, id);
  const files = job?.state === "done" ? completeAsset(config, id) : null;
  if (!job || !files) return Response.json({ error: "No such asset." }, { status: 404 });
  if (what === "model.glb") {
    return new Response(Bun.file(files.glb), {
      headers: { "content-type": "model/gltf-binary", "content-disposition": `attachment; filename="${baseName(job)}.glb"` },
    });
  }
  const path = what === "thumb" ? files.thumb : files.source;
  const ext = path.slice(path.lastIndexOf(".") + 1);
  return new Response(Bun.file(path), { headers: { "content-type": CONTENT[ext] ?? "application/octet-stream", "cache-control": "private, max-age=3600" } });
}

/** Deletes a finished, failed or cancelled job; its files go after the row, and anything left is swept later. */
export function deleteJob(store: Store, config: Config, id: string): Response {
  const job = getJob(store, id);
  if (!job) return Response.json({ error: "No such job." }, { status: 404 });
  const lastOfBatch = store.db.transaction((): boolean | null => {
    const res = store.db.run("DELETE FROM jobs WHERE id = ? AND state IN ('done', 'failed', 'cancelled')", [id]);
    if (res.changes !== 1) return null;
    const left = (store.db.query("SELECT COUNT(*) AS n FROM jobs WHERE batch_id = ?").get(job.batch_id) as { n: number }).n;
    if (left === 0) store.db.run("DELETE FROM batches WHERE id = ?", [job.batch_id]);
    return left === 0;
  }).immediate();
  if (lastOfBatch === null) return Response.json({ error: "Only done, failed or cancelled jobs can be deleted." }, { status: 409 });
  try {
    rmSync(assetDir(config, id), { recursive: true, force: true });
    removeComfyFiles(config, id);
    const uploads = join(config.dataDir, "uploads", job.batch_id);
    if (lastOfBatch && existsSync(uploads)) rmSync(uploads, { recursive: true, force: true });
  } catch {
    // Left for the sweep.
  }
  return new Response(null, { status: 204 });
}
