// HTTP server: routing, authentication and the JSON API. The page and its assets are served by `static.ts`.
import type { Server } from "bun";
import { clientAddress, defaultTrustedPeers, FailureLimiter, makeCookieValue, readCookie, sameSecret, SESSION_COOKIE, sessionCookieHeader, verifyCookieValue } from "./auth.ts";
import { createBatch } from "./batches.ts";
import type { Config } from "./config.ts";
import { getJob, jobView, listJobs, requestCancel, retryJob, type QueueInfo } from "./jobs.ts";
import { openStore, type Store } from "./store.ts";
import { APP_COMMIT, APP_VERSION } from "./version.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MiB = 1024 * 1024;

export type ComfyState = "reachable" | "offline" | "incompatible";

/** What the HTTP layer needs from the tracker. */
export interface TrackerView {
  health(): { comfyui: ComfyState; version: string | null };
  queueInfo(promptId: string | null): QueueInfo | null;
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
  const queueInfo = (id: string | null): QueueInfo | null => tracker?.queueInfo(id) ?? null;

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
    if (!authorised(req)) {
      return presentedCredentials(req) ? failed() : err(401, "Sign in with the access token.");
    }

    if (path === "/api/batches" && req.method === "POST") return createBatch(req, { store, config, now });
    if (path === "/api/jobs" && req.method === "GET") {
      return Response.json({ jobs: listJobs(store, { state: url.searchParams.get("state"), batch: url.searchParams.get("batch") }, queueInfo) });
    }
    const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/(cancel|retry))?$/.exec(path);
    if (jobMatch) {
      const id = jobMatch[1] ?? "";
      const action = jobMatch[2];
      if (!UUID.test(id)) return err(404, "No such job.");
      if (!action && req.method === "GET") {
        const job = getJob(store, id);
        return job ? Response.json({ job: jobView(job, job.state === "submitted" ? queueInfo(job.prompt_id) : null) }) : err(404, "No such job.");
      }
      if (action && req.method === "POST") {
        const result = action === "cancel" ? requestCancel(store, id) : retryJob(store, config, id);
        return result.ok ? new Response(null, { status: 202 }) : err(result.status, result.error);
      }
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
