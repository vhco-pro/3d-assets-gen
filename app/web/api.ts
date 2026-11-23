// The page's only data boundary: typed calls to /api with explicit error handling.
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type JobState = "pending" | "submitted" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  batchId: string;
  position: number;
  kind: "prompt" | "image";
  prompt: string | null;
  upload: string | null;
  engine: string;
  faces: number;
  tex: number | null;
  style: boolean;
  seed: number;
  state: JobState;
  running: boolean;
  queuePosition: number | null;
  error: string | null;
  createdAt: number;
  queuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  sharedStyle: string | null;
  sourceReady: boolean;
}

export interface Health {
  version: string;
  commit: string;
  comfyui: "reachable" | "offline" | "incompatible";
  comfyuiVersion: string | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `The server answered ${String(res.status)}.`;
}

async function call(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, { ...init, credentials: "same-origin", ...(signal ? { signal } : {}) });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return res;
}

function parseJob(v: unknown): Job {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.state !== "string") throw new ApiError(0, "Unexpected job data from the server.");
  return v as unknown as Job;
}

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const body: unknown = await (await call("/api/health", {}, signal)).json();
  if (!isRecord(body) || typeof body.comfyui !== "string") throw new ApiError(0, "Unexpected health data.");
  return body as unknown as Health;
}

export async function fetchJobs(signal?: AbortSignal): Promise<Job[]> {
  const body: unknown = await (await call("/api/jobs", {}, signal)).json();
  if (!isRecord(body) || !Array.isArray(body.jobs)) throw new ApiError(0, "Unexpected job list from the server.");
  return body.jobs.map(parseJob);
}

export async function fetchSession(signal?: AbortSignal): Promise<boolean> {
  const body: unknown = await (await call("/api/session", {}, signal)).json();
  return isRecord(body) && body.signedIn === true;
}

export async function signIn(token: string): Promise<void> {
  await call("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
}

export interface PresetsInput {
  faces: number;
  tex: number;
  sharedStyle?: string | null;
  variants: number;
  style: boolean;
  seed: number | null;
}

export async function submitPrompts(prompts: string[], presets: PresetsInput): Promise<number> {
  const res = await call("/api/batches", {
    method: "POST",
    headers: { "content-type": "application/json", "x-batch-id": crypto.randomUUID() },
    body: JSON.stringify({ kind: "prompt", prompts, presets }),
  });
  return countJobs(await res.json());
}

export async function submitImages(files: File[], presets: PresetsInput): Promise<number> {
  const form = new FormData();
  form.set("presets", JSON.stringify(presets));
  for (const f of files) form.append("images", f, f.name);
  const res = await call("/api/batches", { method: "POST", headers: { "x-batch-id": crypto.randomUUID() }, body: form });
  return countJobs(await res.json());
}

function countJobs(body: unknown): number {
  if (isRecord(body) && isRecord(body.batch) && Array.isArray(body.batch.jobs)) return body.batch.jobs.length;
  return 0;
}

export async function jobAction(id: string, action: "cancel" | "retry"): Promise<void> {
  await call(`/api/jobs/${id}/${action}`, { method: "POST" });
}

export async function deleteJob(id: string): Promise<void> {
  await call(`/api/jobs/${id}`, { method: "DELETE" });
}

export async function startExport(ids: string[]): Promise<string> {
  const res = await call("/api/exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobs: ids }) });
  const body: unknown = await res.json();
  if (!isRecord(body) || typeof body.url !== "string") throw new ApiError(0, "Unexpected export answer.");
  return body.url;
}

/** A 15-minute signed path for the asset's GLB that Scene Viewer can fetch without the session cookie. */
export async function fetchArLink(id: string, signal?: AbortSignal): Promise<string> {
  const body: unknown = await (await call(`/api/assets/${id}/ar-link`, {}, signal)).json();
  if (!isRecord(body) || typeof body.url !== "string") throw new ApiError(0, "Unexpected AR link answer.");
  return body.url;
}
