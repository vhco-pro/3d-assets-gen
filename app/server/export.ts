// Zip exports: POST checks a selection and issues a one-time link; GET streams the zip with a manifest.
import { statSync } from "node:fs";
import { baseName, deleteJob, downloadAsset } from "./assets.ts";
import type { Config } from "./config.ts";
import { completeAsset } from "./files.ts";
import type { ExtraRoutes } from "./http.ts";
import { getJob, type JobRow } from "./jobs.ts";
import type { Store } from "./store.ts";

export { slugFor } from "./assets.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_EXPORT_ASSETS = 100;
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;
const LINK_MS = 5 * 60_000;

interface Pending {
  jobs: string[];
  expires: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcUpdate(crc: number, bytes: Uint8Array): number {
  let c = crc;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return c;
}

interface Entry {
  name: string;
  path?: string;
  data?: Uint8Array;
}

/**
 * Streams a stored (uncompressed) zip, pulling one chunk at a time so a slow client never makes the server
 * buffer the archive. Sizes stay below 4 GiB because exports are capped at 2 GiB.
 */
function zipStream(entries: Entry[]): ReadableStream<Uint8Array> {
  const iterator = zipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  }, { highWaterMark: 1 });
}

async function* zipChunks(entries: Entry[]): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const start = offset;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0808, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    offset += local.length;
    yield local;
    let crc = 0xffffffff;
    let size = 0;
    if (entry.data) {
      crc = crcUpdate(crc, entry.data);
      size = entry.data.length;
      offset += size;
      yield entry.data;
    } else if (entry.path) {
      for await (const chunk of Bun.file(entry.path).stream()) {
        crc = crcUpdate(crc, chunk);
        size += chunk.length;
        offset += chunk.length;
        yield chunk;
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const desc = new Uint8Array(16);
    const dv = new DataView(desc.buffer);
    dv.setUint32(0, 0x08074b50, true);
    dv.setUint32(4, crc, true);
    dv.setUint32(8, size, true);
    dv.setUint32(12, size, true);
    offset += desc.length;
    yield desc;
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0808, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, start, true);
    cd.set(name, 46);
    central.push(cd);
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const cd of central) {
    cdSize += cd.length;
    yield cd;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  yield end;
}

function manifestEntry(job: JobRow, glb: string, source: string): Record<string, unknown> {
  return {
    id: job.id,
    glb,
    source,
    prompt: job.kind === "prompt" ? job.prompt : null,
    upload: job.kind === "image" ? job.upload_name : null,
    engine: job.engine,
    faces: job.faces,
    texture: job.engine === "trellis" ? job.tex : null,
    style: job.style === 1,
    seed: job.seed,
    created: new Date(job.created_at).toISOString(),
  };
}

type Selection = { ok: true; jobs: { job: JobRow; files: NonNullable<ReturnType<typeof completeAsset>> }[] } | { ok: false };

function select(store: Store, config: Config, ids: string[]): Selection {
  const jobs: { job: JobRow; files: NonNullable<ReturnType<typeof completeAsset>> }[] = [];
  for (const id of ids) {
    const job = UUID.test(id) ? getJob(store, id) : null;
    const files = job?.state === "done" ? completeAsset(config, id) : null;
    if (!job || !files) return { ok: false };
    jobs.push({ job, files });
  }
  return { ok: true, jobs };
}

export function assetRoutes(config: Config, now: () => number = Date.now): ExtraRoutes {
  const links = new Map<string, Pending>();
  const prune = (): void => {
    for (const [k, v] of links) if (v.expires <= now()) links.delete(k);
  };
  return {
    async api(req: Request, url: URL, store: Store): Promise<Response | null> {
      const path = url.pathname;
      const asset = /^\/api\/assets\/([^/]+)\/(model\.glb|source|thumb)$/.exec(path);
      if (asset && req.method === "GET") {
        const id = asset[1] ?? "";
        return UUID.test(id) ? downloadAsset(store, config, id, asset[2] ?? "") : Response.json({ error: "No such asset." }, { status: 404 });
      }
      const del = /^\/api\/jobs\/([^/]+)$/.exec(path);
      if (del && req.method === "DELETE") {
        const id = del[1] ?? "";
        return UUID.test(id) ? deleteJob(store, config, id) : Response.json({ error: "No such job." }, { status: 404 });
      }
      if (path === "/api/exports" && req.method === "POST") {
        let ids: unknown;
        try {
          ids = ((await req.json()) as { jobs?: unknown }).jobs;
        } catch {
          ids = undefined;
        }
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x): x is string => typeof x === "string")) {
          return Response.json({ error: "Select at least one done asset." }, { status: 400 });
        }
        if (ids.length > MAX_EXPORT_ASSETS) {
          return Response.json({ error: `Exports hold at most ${String(MAX_EXPORT_ASSETS)} assets and 2 GiB; split the selection.` }, { status: 413 });
        }
        const sel = select(store, config, ids);
        if (!sel.ok) return Response.json({ error: "Only done assets can be exported." }, { status: 400 });
        const bytes = sel.jobs.reduce((n, { files }) => n + statSync(files.glb).size + statSync(files.source).size, 0);
        if (bytes > MAX_EXPORT_BYTES) {
          return Response.json({ error: `Exports hold at most ${String(MAX_EXPORT_ASSETS)} assets and 2 GiB; split the selection.` }, { status: 413 });
        }
        prune();
        const exportId = crypto.randomUUID();
        links.set(exportId, { jobs: ids, expires: now() + LINK_MS });
        return Response.json({ url: `/api/exports/${exportId}` });
      }
      const exp = /^\/api\/exports\/([^/]+)$/.exec(path);
      if (exp && req.method === "GET") {
        prune();
        const pending = links.get(exp[1] ?? "");
        if (!pending) return Response.json({ error: "This export link has expired or was already used." }, { status: 404 });
        links.delete(exp[1] ?? "");
        const sel = select(store, config, pending.jobs);
        if (!sel.ok) return new Response(null, { status: 302, headers: { location: "/?export=gone" } });
        const entries: Entry[] = [];
        const manifest: Record<string, unknown>[] = [];
        for (const { job, files } of sel.jobs) {
          const base = baseName(job);
          const ext = files.source.slice(files.source.lastIndexOf(".") + 1);
          entries.push({ name: `${base}.glb`, path: files.glb }, { name: `${base}.${ext}`, path: files.source });
          manifest.push(manifestEntry(job, `${base}.glb`, `${base}.${ext}`));
        }
        entries.push({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify({ schema: 1, assets: manifest }, null, 2)) });
        const stamp = new Date(now()).toISOString().slice(0, 10);
        return new Response(zipStream(entries), {
          headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="asset-studio-${stamp}.zip"` },
        });
      }
      return null;
    },
  };
}
