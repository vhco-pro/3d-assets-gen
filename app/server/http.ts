// HTTP server: routing, authentication and the JSON API. The page and its assets are served by `static.ts`.
import type { Server } from "bun";
import { signedModelPath, verifySignedModel } from "./arlink.ts";
import { downloadAsset } from "./assets.ts";
import { clientAddress, defaultTrustedPeers, FailureLimiter, makeCookieValue, readCookie, sameSecret, SESSION_COOKIE, sessionCookieHeader, verifyCookieValue } from "./auth.ts";
import { createBatch } from "./batches.ts";
import type { Config } from "./config.ts";
import { completeAsset } from "./files.ts";
import { getJob, jobView, listJobs, requestCancel, retryJob, type JobRow, type QueueInfo } from "./jobs.ts";
import { openStore, type Store } from "./store.ts";
import { APP_COMMIT, APP_VERSION } from "./version.ts";
import { createReporter } from "../cli/report.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MiB = 1024 * 1024;

export type ComfyState = "reachable" | "offline" | "incompatible";

/** What the HTTP layer needs from the tracker. */
export interface TrackerView {
  health(): { comfyui: ComfyState; version: string | null };
  queueInfo(promptId: string | null): QueueInfo | null;
  /** A small source image for an unfinished job, or null when there is none yet (Design > HTTP API). */
  sourcePreview(job: JobRow): string | null;
  stop(): Promise<void>;
}

export interface ExtraRoutes {
  /** Handles authenticated /api routes the core does not know; returns null when it does not match. */
  api?(req: Request, url: URL, store: Store): Promise<Response | null> | Response | null;
  /** Handles non-/api paths (the page). */
  page?(req: Request, url: URL): Promise<Response> | Response;
}

export interface ServerOptions {
  now?: () => number;
  trustedPeers?: Set<string>;
  /** false: no tracker (tests of the HTTP layer). A factory: build one around the store. */
  tracker?: false | ((store: Store) => TrackerView);
  routes?: ExtraRoutes;
  /** Where operational log lines go; the default writes them to standard output. */
  log?: (line: string) => void;
}

export interface RunningServer {
  url: string;
  store: Store;
  tracker: TrackerView | null;
  stop(): Promise<void>;
}

function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export function createServer(config: Config, opts: ServerOptions = {}): RunningServer {
  const now = opts.now ?? Date.now;
  const store = openStore(config.dataDir);
  const trusted = opts.trustedPeers ?? defaultTrustedPeers();
  const limiter = new FailureLimiter(now);
  const tracker = opts.tracker ? opts.tracker(store) : null;
  const log = opts.log ?? ((line: string): void => { createReporter().step(line); });
  const queueInfo = (id: string | null): QueueInfo | null => tracker?.queueInfo(id) ?? null;
  const previewOf = (row: JobRow): string | null => (row.state === "pending" || row.state === "submitted" ? (tracker?.sourcePreview(row) ?? null) : null);

  function authorised(req: Request): boolean {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return sameSecret(auth.slice(7), config.token);
    const cookie = readCookie(req, SESSION_COOKIE);
    return cookie !== null && verifyCookieValue(config.token, cookie, now());
  }

  function presentedCredentials(req: Request): boolean {
    return req.headers.has("authorization") || readCookie(req, SESSION_COOKIE) !== null;
  }

  async function handle(req: Request, peer: string): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      return opts.routes?.page ? opts.routes.page(req, url) : new Response("Not found", { status: 404 });
    }
    const client = clientAddress(peer, req.headers.get("x-forwarded-for"), trusted);
    const failed = (): Response => {
      if (limiter.overLimit(client)) return err(429, "Too many failed sign-in attempts; wait a minute.");
      limiter.record(client);
      return err(401, "Sign in with the access token.");
    };

    if (path === "/api/health" && req.method === "GET") {
      const h = tracker?.health() ?? { comfyui: "offline" as const, version: null };
      return Response.json({ version: APP_VERSION, commit: APP_COMMIT, comfyui: h.comfyui, comfyuiVersion: h.version });
    }
    if (path === "/api/session" && req.method === "GET") {
      // Lets the page learn whether its cookie is valid without a failing call. It looks at the cookie
      // alone (a bearer token here could be used to test tokens) and never counts as a failure.
      const cookie = readCookie(req, SESSION_COOKIE);
      return Response.json({ signedIn: cookie !== null && verifyCookieValue(config.token, cookie, now()) });
    }
    if (path === "/api/session" && req.method === "POST") {
      let token: unknown;
      try {
        token = ((await req.json()) as { token?: unknown }).token;
      } catch {
        token = undefined;
      }
      if (typeof token !== "string" || !sameSecret(token, config.token)) return failed();
      const value = makeCookieValue(config.token, Math.floor(now() / 1000));
      return new Response(null, { status: 204, headers: { "set-cookie": sessionCookieHeader(value) } });
    }
    // A signed GLB link (Scene Viewer cannot send the cookie): served without a session when the signature
    // holds; a wrong or expired one counts as a failed authentication.
    const glbMatch = /^\/api\/assets\/([^/]+)\/model\.glb$/.exec(path);
    if (glbMatch && req.method === "GET" && (url.searchParams.has("exp") || url.searchParams.has("sig"))) {
      const id = glbMatch[1] ?? "";
      if (!UUID.test(id) || !verifySignedModel(config.token, id, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "", now())) return failed();
      const res = downloadAsset(store, config, id, "model.glb");
      if (res.ok) {
        res.headers.set("cache-control", "private, no-store");
        log(`signed GLB ${id} for ${client} (${req.headers.get("user-agent") ?? "no user agent"})`);
      }
      return res;
    }
    if (!authorised(req)) {
      return presentedCredentials(req) ? failed() : err(401, "Sign in with the access token.");
    }

    if (path === "/api/batches" && req.method === "POST") return createBatch(req, { store, config, now });
    if (path === "/api/jobs" && req.method === "GET") {
      return Response.json({ jobs: listJobs(store, { state: url.searchParams.get("state"), batch: url.searchParams.get("batch") }, queueInfo, (r) => previewOf(r) !== null) });
    }
    const previewMatch = /^\/api\/jobs\/([^/]+)\/source-preview$/.exec(path);
    if (previewMatch && req.method === "GET") {
      const id = previewMatch[1] ?? "";
      const job = UUID.test(id) ? getJob(store, id) : null;
      const file = job ? previewOf(job) : null;
      if (!file) return err(404, "No source image yet.");
      const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      const type = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      return new Response(Bun.file(file), { headers: { "content-type": type, "cache-control": "private, max-age=60" } });
    }
    const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/(cancel|retry))?$/.exec(path);
    if (jobMatch) {
      const id = jobMatch[1] ?? "";
      const action = jobMatch[2];
      if (!UUID.test(id)) return err(404, "No such job.");
      if (!action && req.method === "GET") {
        const job = getJob(store, id);
        return job ? Response.json({ job: jobView(job, job.state === "submitted" ? queueInfo(job.prompt_id) : null, previewOf(job) !== null) }) : err(404, "No such job.");
      }
      if (action && req.method === "POST") {
        const result = action === "cancel" ? requestCancel(store, id) : retryJob(store, config, id, now());
        return result.ok ? new Response(null, { status: 202 }) : err(result.status, result.error);
      }
    }
    const arMatch = /^\/api\/assets\/([^/]+)\/ar-link$/.exec(path);
    if (arMatch && req.method === "GET") {
      const id = arMatch[1] ?? "";
      const job = UUID.test(id) ? getJob(store, id) : null;
      if (!job || job.state !== "done" || !completeAsset(config, id)) return err(404, "No such asset.");
      return Response.json({ url: signedModelPath(config.token, id, now()) }, { headers: { "cache-control": "no-store" } });
    }
    const extra = await opts.routes?.api?.(req, url, store);
    if (extra) return extra;
    return err(404, "Not found.");
  }

  const [host, portText] = splitListen(config.listen);
  const server: Server<undefined> = Bun.serve({
    hostname: host,
    port: Number(portText),
    maxRequestBodySize: 256 * MiB,
    idleTimeout: 120,
    fetch: (req, srv) => handle(req, srv.requestIP(req)?.address ?? "0.0.0.0"),
  });
  return {
    url: `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${String(server.port)}`,
    store,
    tracker,
    stop: async () => {
      await tracker?.stop();
      await server.stop(true);
      store.close();
    },
  };
}

function splitListen(listen: string): [string, string] {
  const i = listen.lastIndexOf(":");
  return [listen.slice(0, i), listen.slice(i + 1)];
}
