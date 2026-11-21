// POST /api/batches: validation, streamed uploads, idempotent batch IDs and the transactional insert.
import busboy from "busboy";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, type WriteStream } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { DETAILS, ENGINES, MAX_SEED, MAX_VARIANTS, planJobs, TEXTURES, type Presets } from "../pipeline/presets.ts";
import type { Config } from "./config.ts";
import { jobView, type JobRow } from "./jobs.ts";
import type { Store } from "./store.ts";

const MiB = 1024 * 1024;
export const JSON_BATCH_LIMIT = MiB;
export const MAX_IMAGE_BYTES = 20 * MiB;
export const MAX_PROMPT_CHARS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface BatchContext {
  store: Store;
  config: Config;
  now: () => number;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

type ImageExt = "png" | "jpg" | "webp";
function sniff(head: Uint8Array): ImageExt | null {
  const b = (i: number): number => head[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "jpg";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "webp";
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parsePresets(raw: unknown): Presets {
  if (!isRecord(raw)) return fail(400, "presets are missing.");
  const engine = raw.engine;
  if (typeof engine !== "string" || !(ENGINES as readonly string[]).includes(engine)) return fail(400, "engine must be trellis or hunyuan.");
  const faces = raw.faces;
  if (typeof faces !== "number" || !(DETAILS as readonly number[]).includes(faces)) return fail(400, "detail must be 5000, 10000 or 20000 triangles.");
  let tex: Presets["tex"] = null;
  if (engine === "trellis") {
    const t = raw.tex;
    if (typeof t !== "number" || !(TEXTURES as readonly number[]).includes(t)) return fail(400, "texture must be 1024 or 2048.");
    tex = t as Presets["tex"];
  }
  const variants = raw.variants;
  if (typeof variants !== "number" || !Number.isInteger(variants) || variants < 1 || variants > MAX_VARIANTS) {
    return fail(400, `variants must be between 1 and ${String(MAX_VARIANTS)}.`);
  }
  const style = raw.style;
  if (typeof style !== "boolean") return fail(400, "game-asset style must be on or off.");
  const seed = raw.seed;
  if (seed !== null && (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED)) {
    return fail(400, `seed must be empty or a whole number from 0 to ${String(MAX_SEED)}.`);
  }
  return { engine: engine as Presets["engine"], faces: faces as Presets["faces"], tex, variants, style, seed: seed };
}

function canonicalHash(kind: "prompt" | "image", presets: Presets, items: string[]): string {
  return createHash("sha256").update(JSON.stringify({ kind, presets, items })).digest("hex");
}

async function readLimited(req: Request, limit: number): Promise<string> {
  const body = req.body as ReadableStream<Uint8Array> | null;
  const reader = body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      fail(413, "A prompt batch can be at most 1 MiB.");
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf8");
}

interface ParsedImage {
  name: string;
  ext: ImageExt;
  sha256: string;
}

/** Streams a multipart image batch to `stagingDir` (or only hashes it when `stagingDir` is null). */
async function parseMultipart(req: Request, stagingDir: string | null, totalLimit: number): Promise<{ presets: unknown; images: ParsedImage[] }> {
  const body = req.body;
  if (!body) fail(400, "Add at least one prompt or image.");
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  if (stagingDir) mkdirSync(stagingDir, { recursive: true });
  return new Promise((resolve, reject) => {
    let presets: unknown = undefined;
    let total = 0;
    let failed: HttpError | null = null;
    const images: ParsedImage[] = [];
    const writes: Promise<void>[] = [];
    let bb: busboy.Busboy;
    try {
      bb = busboy({ headers, limits: { fileSize: MAX_IMAGE_BYTES + 1, files: 1000, fields: 10, fieldSize: 64 * 1024 } });
    } catch {
      reject(new HttpError(400, "The batch must be JSON prompts or multipart images."));
      return;
    }
    const source = Readable.fromWeb(body as unknown as NodeWebReadableStream);
    const abort = (err: HttpError): void => {
      if (failed) return;
      failed = err;
      source.unpipe(bb);
      source.destroy();
      reject(err);
    };
    bb.on("field", (name, value) => {
      if (name === "presets") {
        try {
          presets = JSON.parse(value) as unknown;
        } catch {
          abort(new HttpError(400, "presets must be JSON."));
        }
      }
    });
    bb.on("file", (field, stream, info) => {
      if (failed || field !== "images") {
        stream.resume();
        return;
      }
      const index = images.length;
      const name = basename(info.filename || `image-${String(index)}`);
      const hash = createHash("sha256");
      let head = new Uint8Array(0);
      let ext: ImageExt | null = null;
      let out: WriteStream | null = null;
      const entry: ParsedImage = { name, ext: "png", sha256: "" };
      images.push(entry);
      stream.on("data", (chunk: Buffer) => {
        if (failed) return;
        total += chunk.length;
        if (total > totalLimit) {
          abort(new HttpError(413, `The images in a batch can add up to at most ${String(Math.floor(totalLimit / MiB))} MiB.`));
          return;
        }
        if (ext === null) {
          const merged = new Uint8Array(head.length + chunk.length);
          merged.set(head);
          merged.set(chunk, head.length);
          head = merged;
          if (head.length < 12) return;
          ext = sniff(head);
          if (!ext) {
            abort(new HttpError(400, `${name} is not a PNG, JPEG or WebP image.`));
            return;
          }
          entry.ext = ext;
          hash.update(head);
          if (stagingDir) {
            out = createWriteStream(join(stagingDir, `${String(index)}.${ext}`));
            out.write(head);
          }
          return;
        }
        hash.update(chunk);
        if (out && !out.write(chunk)) {
          // Respect the disk: pause the upload until the file has drained, so memory stays flat.
          stream.pause();
          out.once("drain", () => stream.resume());
        }
      });
      stream.on("limit", () => {
        abort(new HttpError(400, `${name} is larger than 20 MiB.`));
      });
      writes.push(new Promise<void>((done) => {
        stream.on("end", () => {
          if (!failed && ext === null) abort(new HttpError(400, `${name} is not a PNG, JPEG or WebP image.`));
          entry.sha256 = hash.digest("hex");
          if (out) out.end(() => { done(); });
          else done();
        });
      }));
    });
    bb.on("error", () => {
      abort(new HttpError(400, "The upload could not be read."));
    });
    bb.on("close", () => {
      if (failed) return;
      void Promise.all(writes).then(() => {
        if (!failed) resolve({ presets, images });
      });
    });
    source.on("error", () => {
      abort(new HttpError(400, "The upload was interrupted."));
    });
    source.pipe(bb);
  });
}

function existingBatch(store: Store, id: string): { hash: string } | null {
  return store.db.query("SELECT hash FROM batches WHERE id = ?").get(id) as { hash: string } | null;
}

function batchJobs(store: Store, id: string): ReturnType<typeof jobView>[] {
  const rows = store.db.query("SELECT * FROM jobs WHERE batch_id = ? ORDER BY position").all(id) as JobRow[];
  return rows.map((r) => jobView(r, null));
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

export async function createBatch(req: Request, ctx: BatchContext): Promise<Response> {
  const id = req.headers.get("x-batch-id") ?? "";
  if (!UUID.test(id)) return json(400, { error: "X-Batch-Id must be a lowercase UUID batch ID." });
  const { store, config } = ctx;
  const type = req.headers.get("content-type") ?? "";
  const length = Number(req.headers.get("content-length") ?? "0");
  let stagingDir: string | null = null;
  try {
    let kind: "prompt" | "image";
    let presets: Presets;
    let items: string[];
    let images: ParsedImage[] = [];
    if (type.includes("application/json")) {
      if (length > JSON_BATCH_LIMIT) fail(413, "A prompt batch can be at most 1 MiB.");
      let raw: unknown;
      try {
        raw = JSON.parse(await readLimited(req, JSON_BATCH_LIMIT)) as unknown;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        return fail(400, "The batch is not valid JSON.");
      }
      if (!isRecord(raw) || raw.kind !== "prompt" || !Array.isArray(raw.prompts)) return fail(400, "A JSON batch needs kind \"prompt\" and a prompts list.");
      presets = parsePresets(raw.presets);
      kind = "prompt";
      items = raw.prompts.map((p) => (typeof p === "string" ? p.trim() : "")).filter((p) => p.length > 0);
      if (items.length === 0) fail(400, "Add at least one prompt or image.");
      items.forEach((p, i) => {
        if (p.length > MAX_PROMPT_CHARS) fail(400, `Prompt ${String(i + 1)} is longer than 500 characters.`);
      });
    } else if (type.includes("multipart/form-data")) {
      if (length > config.limits.batchImageBytes + MiB) {
        fail(413, `The images in a batch can add up to at most ${String(Math.floor(config.limits.batchImageBytes / MiB))} MiB.`);
      }
      kind = "image";
      if (!existingBatch(store, id)) stagingDir = join(config.dataDir, "staging", `${id}-${crypto.randomUUID()}`);
      const parsed = await parseMultipart(req, stagingDir, config.limits.batchImageBytes);
      presets = parsePresets(parsed.presets);
      images = parsed.images;
      if (images.length === 0) fail(400, "Add at least one prompt or image.");
      items = images.map((im) => `${im.name}\u0000${im.sha256}`);
    } else {
      return fail(400, "The batch must be JSON prompts or multipart images.");
    }
    const hash = canonicalHash(kind, presets, items);
    const before = existingBatch(store, id);
    if (before) {
      return before.hash === hash ? json(200, { batch: { id, jobs: batchJobs(store, id) } }) : fail(409, `Batch ID ${id} was already used for different content.`);
    }
    const planned = planJobs(items.length, presets, kind);
    if (planned.length > config.limits.batchJobs) {
      fail(400, `A batch can hold at most ${String(config.limits.batchJobs)} jobs; this one has ${String(planned.length)}.`);
    }
    const now = ctx.now();
    const uploadsDir = join(config.dataDir, "uploads", id);
    const insert = store.db.transaction((): Response => {
      const again = existingBatch(store, id);
      if (again) {
        return again.hash === hash ? json(200, { batch: { id, jobs: batchJobs(store, id) } }) : fail(409, `Batch ID ${id} was already used for different content.`);
      }
      const unfinished = (store.db.query("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('pending', 'submitted')").get() as { n: number }).n;
      if (unfinished + planned.length > config.limits.unfinishedJobs) {
        fail(409, `There can be at most ${String(config.limits.unfinishedJobs)} unfinished jobs; this batch would make ${String(unfinished + planned.length)}.`);
      }
      store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, ?, ?, ?, ?)", [id, kind, JSON.stringify(presets), hash, now]);
      const stmt = store.db.prepare(`INSERT INTO jobs (id, batch_id, position, kind, prompt, upload_name, upload_ext, engine, faces, tex, style, seed, state, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`);
      for (const job of planned) {
        const image = kind === "image" ? images[job.line] : undefined;
        stmt.run(
          crypto.randomUUID(), id, job.position, kind,
          kind === "prompt" ? (items[job.line] ?? "") : null,
          image?.name ?? null, image?.ext ?? null,
          presets.engine, presets.faces, presets.tex, presets.style ? 1 : 0, job.seed, now,
        );
      }
      if (stagingDir) {
        mkdirSync(join(config.dataDir, "uploads"), { recursive: true });
        renameSync(stagingDir, uploadsDir);
        stagingDir = null;
      }
      return json(201, { batch: { id, jobs: batchJobs(store, id) } });
    });
    return insert.immediate();
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    throw e;
  } finally {
    if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
  }
}
