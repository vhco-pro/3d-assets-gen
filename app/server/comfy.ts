// Typed client for the parts of the ComfyUI HTTP API the tracker uses. Every call has a timeout, and
// failures are typed as unreachable (connection or timeout), server (5xx or unparsable) or rejected (4xx).
import { readFileSync } from "node:fs";

export type ComfyErrorKind = "unreachable" | "server" | "rejected";

export class ComfyError extends Error {
  constructor(readonly kind: ComfyErrorKind, message: string, readonly status?: number) {
    super(message);
  }
}

export interface OutputFile {
  filename: string;
  subfolder: string;
  type: string;
}

export interface HistoryEntry {
  status: "success" | "error";
  message: string | null;
  files: OutputFile[];
}

export interface QueueSnapshot {
  running: string[];
  pending: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function queueIds(list: unknown): string[] {
  if (!Array.isArray(list)) throw new ComfyError("server", "ComfyUI /queue answer is not a list");
  return list.map((item) => {
    if (!Array.isArray(item) || typeof item[1] !== "string") throw new ComfyError("server", "ComfyUI /queue item has no prompt ID");
    return item[1];
  });
}

/** Every {filename, subfolder, type} dict anywhere in a history entry's outputs. */
function outputFiles(outputs: unknown): OutputFile[] {
  const files: OutputFile[] = [];
  if (!isRecord(outputs)) return files;
  for (const node of Object.values(outputs)) {
    if (!isRecord(node)) continue;
    for (const list of Object.values(node)) {
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (isRecord(f) && typeof f.filename === "string") {
          files.push({ filename: f.filename, subfolder: typeof f.subfolder === "string" ? f.subfolder : "", type: typeof f.type === "string" ? f.type : "output" });
        }
      }
    }
  }
  return files;
}

function statusMessage(status: Record<string, unknown>): string | null {
  const messages = status.messages;
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    if (!Array.isArray(m)) continue;
    const [kind, data] = m as [unknown, unknown];
    if (kind === "execution_error" && isRecord(data)) {
      const node = typeof data.node_type === "string" ? `${data.node_type}: ` : "";
      return `${node}${typeof data.exception_message === "string" ? data.exception_message : "execution error"}`;
    }
    if (kind === "execution_interrupted") return "Interrupted in ComfyUI.";
  }
  return null;
}

export class ComfyClient {
  readonly timeoutMs: number;
  constructor(readonly baseUrl: string, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new ComfyError("unreachable", `ComfyUI did not answer ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status >= 500) throw new ComfyError("server", `ComfyUI answered ${String(res.status)} to ${path}`, res.status);
    if (res.status >= 400) {
      const text = await res.text().catch(() => "");
      throw new ComfyError("rejected", `ComfyUI rejected ${path} (${String(res.status)}): ${text.slice(0, 2000)}`, res.status);
    }
    return res;
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await this.request(path, init);
    try {
      return await res.json();
    } catch {
      throw new ComfyError("server", `ComfyUI answered ${path} with something that is not JSON`);
    }
  }

  async version(): Promise<string | null> {
    const body = await this.json("/system_stats");
    if (!isRecord(body) || !isRecord(body.system)) return null;
    return typeof body.system.comfyui_version === "string" ? body.system.comfyui_version : null;
  }

  async queue(): Promise<QueueSnapshot> {
    const body = await this.json("/queue");
    if (!isRecord(body)) throw new ComfyError("server", "ComfyUI /queue answer is not an object");
    return { running: queueIds(body.queue_running), pending: queueIds(body.queue_pending) };
  }

  async history(promptId: string): Promise<HistoryEntry | null> {
    const body = await this.json(`/history/${encodeURIComponent(promptId)}`);
    if (!isRecord(body)) throw new ComfyError("server", "ComfyUI /history answer is not an object");
    const entry = body[promptId];
    if (!isRecord(entry)) return null;
    const status = isRecord(entry.status) ? entry.status : {};
    const ok = status.status_str === "success" || (status.status_str === undefined && status.completed === true);
    return { status: ok ? "success" : "error", message: ok ? null : (statusMessage(status) ?? "ComfyUI reported an error."), files: outputFiles(entry.outputs) };
  }

  async postPrompt(graph: unknown, promptId: string): Promise<void> {
    await this.json("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, prompt_id: promptId, client_id: "asset-studio" }),
    });
  }

  /** Per-job cancel: true when a pending or running prompt was cancelled, false for finished or unknown IDs. */
  async cancel(promptId: string): Promise<boolean> {
    const body = await this.json(`/api/jobs/${encodeURIComponent(promptId)}/cancel`, { method: "POST" });
    return isRecord(body) && body.cancelled === true;
  }

  async upload(path: string, name: string, mime: string): Promise<void> {
    const form = new FormData();
    form.set("image", new Blob([readFileSync(path)], { type: mime }), name);
    form.set("subfolder", "asset-studio");
    form.set("overwrite", "true");
    await this.request("/upload/image", { method: "POST", body: form });
  }

  /** Downloads an output file; null when ComfyUI no longer has it. */
  async view(file: OutputFile): Promise<Uint8Array | null> {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
    try {
      const res = await this.request(`/view?${q.toString()}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (e instanceof ComfyError && e.kind === "rejected" && e.status === 404) return null;
      throw e;
    }
  }
}
