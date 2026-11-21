// Deterministic stand-in for the ComfyUI HTTP API that Asset Studio uses. It runs one prompt at a time,
// writes small but valid output files under its output folder, and exposes controls for the failure modes
// the tests need: delays, rejections, server errors, restarts that drop the queue, lost outputs and
// version changes. Tests drive it in-process; the Playwright harness drives it through /_control.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { solidPng, texturedGlb } from "./assets.ts";

export interface FakeOptions {
  outputDir: string;
  inputDir: string;
  /** Data directory of the app, for fixture prompt lookup. */
  dataDir?: string;
  version?: string;
  runMs?: number;
}

interface QueueItem {
  number: number;
  id: string;
  prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  extra: Record<string, unknown>;
}

interface HistoryEntry {
  prompt: [number, string, unknown, Record<string, unknown>, string[]];
  outputs: Record<string, Record<string, { filename: string; subfolder: string; type: string }[]>>;
  status: { status_str: "success" | "error"; completed: boolean; messages: [string, Record<string, unknown>][] };
}

export interface CallRecord {
  method: string;
  path: string;
  body?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class FakeComfy {
  version: string;
  runMs: number;
  calls: CallRecord[] = [];
  private running: (QueueItem & { done: Promise<void>; cancel: () => void }) | null = null;
  private pending: QueueItem[] = [];
  private history = new Map<string, HistoryEntry>();
  private counter = 0;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private port = 0;
  /** Prompt IDs whose /prompt calls answer 500. */
  serverErrorFor = new Set<string>();
  /** Next /prompt answers 400 with this message. */
  rejectNext: string | null = null;
  /** Next /upload/image answers 400 with this message. */
  rejectNextUpload: string | null = null;
  /** Prompt IDs that fail during execution with this message. */
  failWith = new Map<string, string>();
  /** Delay the HTTP answer to /prompt by this many ms; the prompt is queued after `acceptAfterMs`. */
  promptAnswerDelayMs = 0;
  acceptAfterMs = 0;
  /** Hold prompts running until released (for timeout and cancel tests). */
  holdRunning = false;

  constructor(private opts: FakeOptions) {
    this.version = opts.version ?? "0.46.2";
    this.runMs = opts.runMs ?? 50;
    mkdirSync(opts.outputDir, { recursive: true });
    mkdirSync(opts.inputDir, { recursive: true });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  start(port = 0): void {
    this.server = Bun.serve({ port, hostname: "127.0.0.1", fetch: (req) => this.handle(req) });
    this.port = this.server.port ?? 0;
  }

  /** Stop answering, keeping state; `start(samePort)` resumes. */
  stop(): void {
    void this.server?.stop(true);
    this.server = null;
  }

  get listeningPort(): number {
    return this.port;
  }

  /** Simulate a ComfyUI restart: queue and history are gone. */
  restart(): void {
    this.running?.cancel();
    this.running = null;
    this.pending = [];
    this.history.clear();
  }

  /** Remove the output files of a finished prompt (they "can no longer be fetched"). */
  dropOutputs(id: string): void {
    const entry = this.history.get(id);
    if (!entry) return;
    for (const node of Object.values(entry.outputs)) {
      for (const files of Object.values(node)) {
        for (const f of files) rmSync(join(this.opts.outputDir, f.subfolder, f.filename), { force: true });
      }
    }
  }

  release(): void {
    this.holdRunning = false;
  }

  promptCalls(): CallRecord[] {
    return this.calls.filter((c) => c.path === "/prompt" && c.method === "POST");
  }

  private fixtureIds(): string[] {
    const dataDir = this.opts.dataDir;
    if (!dataDir) return [];
    const path = join(dataDir, "asset-studio.sqlite");
    if (!existsSync(path)) return [];
    try {
      const db = new Database(path, { readonly: true });
      try {
        const rows = db.query("SELECT prompt_id FROM jobs WHERE fixture = 1 AND state = 'submitted' AND prompt_id IS NOT NULL ORDER BY created_at, position").all() as { prompt_id: string }[];
        return rows.map((r) => r.prompt_id);
      } finally {
        db.close();
      }
    } catch {
      return [];
    }
  }

  private queueSnapshot(): { queue_running: unknown[]; queue_pending: unknown[] } {
    const fixtures = this.fixtureIds();
    const row = (q: QueueItem): unknown[] => [q.number, q.id, q.prompt, q.extra, []];
    const running: unknown[] = this.running ? [row(this.running)] : [];
    const pending: unknown[] = this.pending.map(row);
    fixtures.forEach((id, i) => {
      const item = [1_000_000 + i, id, {}, {}, []];
      if (i === 0 && running.length === 0) running.push(item);
      else pending.push(item);
    });
    return { queue_running: running, queue_pending: pending };
  }

  private enqueue(item: QueueItem): void {
    this.pending.push(item);
    this.pump();
  }

  private pump(): void {
    if (this.running) return;
    const next = this.pending.shift();
    if (!next) return;
    let cancelled = false;
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.running = {
      ...next,
      done,
      cancel: () => {
        cancelled = true;
        finish();
      },
    };
    const run = async (): Promise<void> => {
      await Bun.sleep(this.runMs);
      while (this.holdRunning && !cancelled) await Bun.sleep(20);
      if (!cancelled && this.running?.id === next.id) {
        this.complete(next, this.failWith.get(next.id) ?? null, false);
      }
      finish();
      if (this.running?.id === next.id) this.running = null;
      this.pump();
    };
    void run();
  }

  private complete(item: QueueItem, error: string | null, interrupted: boolean): void {
    const outputs: HistoryEntry["outputs"] = {};
    if (!error && !interrupted) {
      for (const [nodeId, node] of Object.entries(item.prompt)) {
        if (node.class_type !== "SaveImage" && node.class_type !== "SaveGLB") continue;
        const prefix = String(node.inputs.filename_prefix);
        const subfolder = dirname(prefix) === "." ? "" : dirname(prefix);
        const base = prefix.slice(subfolder ? subfolder.length + 1 : 0);
        this.counter += 1;
        const ext = node.class_type === "SaveGLB" ? "glb" : "png";
        const filename = `${base}_${String(this.counter).padStart(5, "0")}_.${ext}`;
        const path = join(this.opts.outputDir, subfolder, filename);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, ext === "glb" ? texturedGlb() : solidPng(64, 64, [90, 140, 200]));
        outputs[nodeId] = { [ext === "glb" ? "3d" : "images"]: [{ filename, subfolder, type: "output" }] };
      }
    }
    const messages: HistoryEntry["status"]["messages"] = [];
    if (error) messages.push(["execution_error", { prompt_id: item.id, exception_message: error }]);
    if (interrupted) messages.push(["execution_interrupted", { prompt_id: item.id }]);
    this.history.set(item.id, {
      prompt: [item.number, item.id, item.prompt, item.extra, []],
      outputs,
      status: { status_str: error || interrupted ? "error" : "success", completed: !error && !interrupted, messages },
    });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    let body: unknown;
    if (req.method === "POST" && req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json().catch(() => undefined);
    }
    this.calls.push({ method: req.method, path, body });

    if (path === "/asset-studio-fake") return Response.json({ fake: true });
    if (path === "/system_stats") {
      return Response.json({
        system: { os: "fake", comfyui_version: this.version },
        devices: [{ name: "fake", type: "cuda", vram_total: 16e9, vram_free: 8e9 }],
      });
    }
    if (path === "/queue" && req.method === "GET") return Response.json(this.queueSnapshot());
    if (path.startsWith("/history/")) {
      const id = path.slice("/history/".length);
      const entry = this.history.get(id);
      return Response.json(entry ? { [id]: entry } : {});
    }
    if (path === "/prompt" && req.method === "POST") return this.postPrompt(body);
    if (path === "/interrupt") return new Response(null, { status: 200 });
    const cancel = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (cancel && req.method === "POST") return Response.json({ cancelled: this.cancel(cancel[1] ?? "") });
    if (path === "/upload/image" && req.method === "POST") return this.upload(req);
    if (path === "/view") {
      const file = Bun.file(join(this.opts.outputDir, url.searchParams.get("subfolder") ?? "", url.searchParams.get("filename") ?? ""));
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    }
    if (path === "/_control" && req.method === "POST") return this.control(body);
    return new Response("not found", { status: 404 });
  }

  private async postPrompt(body: unknown): Promise<Response> {
    const b = body as { prompt?: QueueItem["prompt"]; prompt_id?: string; client_id?: string } | undefined;
    const id = b?.prompt_id ?? crypto.randomUUID();
    if (!UUID.test(id)) {
      return Response.json({ error: { type: "invalid_prompt_id", message: "prompt_id must be a valid UUID" }, node_errors: {} }, { status: 400 });
    }
    if (this.rejectNext) {
      const message = this.rejectNext;
      this.rejectNext = null;
      return Response.json({ error: { type: "prompt_outputs_failed_validation", message }, node_errors: { "1": { errors: [message] } } }, { status: 400 });
    }
    if (this.serverErrorFor.has(id)) return new Response("internal error", { status: 500 });
    const item: QueueItem = { number: ++this.counter, id, prompt: b?.prompt ?? {}, extra: { client_id: b?.client_id } };
    if (this.acceptAfterMs > 0) {
      const after = this.acceptAfterMs;
      setTimeout(() => {
        this.enqueue(item);
      }, after);
    } else {
      this.enqueue(item);
    }
    if (this.promptAnswerDelayMs > 0) await Bun.sleep(this.promptAnswerDelayMs);
    return Response.json({ prompt_id: id, number: item.number, node_errors: {} });
  }

  private cancel(id: string): boolean {
    if (this.running?.id === id) {
      const item = this.running;
      this.running.cancel();
      this.complete(item, null, true);
      this.running = null;
      this.pump();
      return true;
    }
    const idx = this.pending.findIndex((p) => p.id === id);
    if (idx >= 0) {
      this.pending.splice(idx, 1);
      return true;
    }
    return false;
  }

  private async upload(req: Request): Promise<Response> {
    if (this.rejectNextUpload) {
      const message = this.rejectNextUpload;
      this.rejectNextUpload = null;
      return Response.json({ error: message }, { status: 400 });
    }
    // The fake only receives uploads from the app under test, so buffering the form is acceptable here.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof Blob)) return new Response("no image", { status: 400 });
    const sub = form.get("subfolder");
    const subfolder = typeof sub === "string" ? sub : "";
    const name = file instanceof File ? file.name : "upload.png";
    const path = join(this.opts.inputDir, subfolder, name);
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, file);
    return Response.json({ name, subfolder, type: "input" });
  }

  private control(body: unknown): Response {
    const b = (body ?? {}) as { action?: string; version?: string; message?: string; id?: string };
    switch (b.action) {
      case "version":
        this.version = b.version ?? this.version;
        break;
      case "restart":
        this.restart();
        break;
      case "reject-next":
        this.rejectNext = b.message ?? "rejected";
        break;
      case "hold":
        this.holdRunning = true;
        break;
      case "release":
        this.release();
        break;
      default:
        return new Response("unknown action", { status: 400 });
    }
    return Response.json({ ok: true });
  }
}
