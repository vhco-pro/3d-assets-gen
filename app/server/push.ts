// "Asset ready" notifications through Web Push (feature document asset-studio-mobile, Design > Notifications):
// the VAPID key pair and the subscriptions in <data dir>/push.json, the /api/push routes, and the sender, which
// encrypts with RFC 8291 (aes128gcm) and signs an RFC 8292 VAPID JWT with WebCrypto. No dependency is added.
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobRow } from "./jobs.ts";
import { createReporter } from "../cli/report.ts";

export const VAPID_SUBJECT = "https://github.com/vhco-pro/3d-assets-gen";
export const MAX_SUBSCRIPTIONS = 20;
const JWT_SECONDS = 12 * 3600;
const SEND_TIMEOUT_MS = 10_000;
const NAME_CHARS = 80;
const RECORD_SIZE = 4096;

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. */
  publicKey: string;
  /** The private scalar d (32 bytes), base64url. */
  privateKey: string;
}

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: number;
  /** First 16 hex characters of HMAC-SHA256("push") keyed with the access token it was saved under. */
  token: string;
}

interface State {
  vapid: VapidKeys;
  subscriptions: Subscription[];
}

export interface PushOptions {
  dataDir: string;
  token: string;
  now?: () => number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

export interface Push {
  publicKey(): Promise<string>;
  /** Handles /api/push/* (the caller has already checked the session); null for any other path. */
  route(req: Request, url: URL): Promise<Response | null>;
  /** Sends "asset ready" to every subscription saved under the current token; never rejects. */
  jobDone(job: JobRow): Promise<void>;
  /** Resolves once every send and every write started so far has finished. */
  idle(): Promise<void>;
}

// ---- encoding helpers -------------------------------------------------------------------------------

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;
function fromB64u(s: string): Uint8Array | null {
  return B64U.test(s) ? new Uint8Array(Buffer.from(s, "base64url")) : null;
}
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", concat(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, concat(data)));
}

function privateJwk(d: Uint8Array, publicKey: Uint8Array) {
  return { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(publicKey.subarray(1, 33)), y: b64u(publicKey.subarray(33, 65)), ext: true };
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: b64u(pub), privateKey: jwk.d ?? "" };
}

// ---- RFC 8291 and RFC 8292 --------------------------------------------------------------------------

/**
 * Encrypts one Web Push message (RFC 8291, aes128gcm, a single record). The sender key pair and the salt are
 * fresh for every message unless given (tests use the RFC's example values).
 */
export async function encryptAes128gcm(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  opts: { asPrivate?: Uint8Array; asPublic?: Uint8Array; salt?: Uint8Array; rs?: number } = {},
): Promise<Uint8Array> {
  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (opts.asPrivate && opts.asPublic) {
    asPublic = opts.asPublic;
    asPrivate = await crypto.subtle.importKey("jwk", privateJwk(opts.asPrivate, asPublic), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const rs = opts.rs ?? RECORD_SIZE;
  if (plaintext.length + 1 + 16 > rs) throw new Error("push payload too large for one record");
  const uaKey = await crypto.subtle.importKey("raw", concat(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).subarray(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).subarray(0, 12);
  const key = await crypto.subtle.importKey("raw", concat(cek), "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: concat(nonce) }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

/** An ES256 VAPID JWT for the push service's origin, valid for 12 hours (RFC 8292). */
export async function vapidJwt(audience: string, keys: VapidKeys, nowMs: number): Promise<string> {
  const pub = fromB64u(keys.publicKey);
  const d = fromB64u(keys.privateKey);
  if (!pub || !d) throw new Error("the VAPID keys in push.json are not base64url");
  const key = await crypto.subtle.importKey("jwk", privateJwk(d, pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + JWT_SECONDS, sub: VAPID_SUBJECT })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64u(sig)}`;
}

export function tokenFingerprint(token: string): string {
  return createHmac("sha256", token).update("push").digest("hex").slice(0, 16);
}

/** The notification's text: the prompt, or the upload's file name, cut to its first 80 code points. */
export function notificationName(job: Pick<JobRow, "kind" | "prompt" | "upload_name">): string {
  const text = job.kind === "prompt" ? (job.prompt ?? "") : (job.upload_name ?? "image");
  return Array.from(text).slice(0, NAME_CHARS).join("");
}

// ---- state ------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseState(text: string): State | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !isRecord(raw.vapid) || typeof raw.vapid.publicKey !== "string" || typeof raw.vapid.privateKey !== "string" || !Array.isArray(raw.subscriptions)) return null;
  if (fromB64u(raw.vapid.publicKey)?.length !== 65 || fromB64u(raw.vapid.privateKey)?.length !== 32) return null;
  const subscriptions = raw.subscriptions.filter((s): s is Subscription =>
    isRecord(s) && typeof s.endpoint === "string" && typeof s.p256dh === "string" && typeof s.auth === "string" && typeof s.createdAt === "number" && typeof s.token === "string");
  return { vapid: { publicKey: raw.vapid.publicKey, privateKey: raw.vapid.privateKey }, subscriptions };
}

type Checked = { ok: true; sub: Pick<Subscription, "endpoint" | "p256dh" | "auth"> } | { ok: false; field: string };

function checkSubscription(body: unknown): Checked {
  if (!isRecord(body) || typeof body.endpoint !== "string") return { ok: false, field: "endpoint" };
  let endpoint: URL;
  try {
    endpoint = new URL(body.endpoint);
  } catch {
    return { ok: false, field: "endpoint" };
  }
  if (endpoint.protocol !== "https:") return { ok: false, field: "endpoint" };
  const keys = isRecord(body.keys) ? body.keys : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  const pub = fromB64u(p256dh);
  if (pub?.length !== 65 || pub[0] !== 4) return { ok: false, field: "keys.p256dh" };
  if (fromB64u(auth)?.length !== 16) return { ok: false, field: "keys.auth" };
  return { ok: true, sub: { endpoint: body.endpoint, p256dh, auth } };
}

export function createPush(opts: PushOptions): Push {
  const file = join(opts.dataDir, "push.json");
  const now = opts.now ?? Date.now;
  const send = opts.fetch ?? fetch;
  const log = opts.log ?? ((line: string): void => { createReporter().step(line); });
  const fingerprint = tokenFingerprint(opts.token);
  let chain: Promise<unknown> = Promise.resolve();
  const inFlight = new Set<Promise<unknown>>();

  const write = (state: State): void => {
    mkdirSync(opts.dataDir, { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };

  // Loaded once; a missing or corrupt file starts empty with new keys (the page re-subscribes on its next load).
  const loaded: Promise<State> = (async () => {
    let text: string | null;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = null;
    }
    const parsed = text === null ? null : parseState(text);
    if (parsed) return parsed;
    if (text !== null) log("push.json was unreadable; starting with new push keys and no subscriptions");
    const fresh: State = { vapid: await generateVapidKeys(), subscriptions: [] };
    write(fresh);
    return fresh;
  })();

  /** Runs one change to the state through the promise chain, then writes the file. */
  const mutate = (change: (state: State) => void): Promise<void> => {
    const next = chain.then(async () => {
      const state = await loaded;
      change(state);
      write(state);
    });
    chain = next.catch((e: unknown) => { log(`push.json could not be written: ${e instanceof Error ? e.message : String(e)}`); });
    return next;
  };

  const track = <T>(p: Promise<T>): Promise<T> => {
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p)).catch(() => undefined);
    return p;
  };

  const removeEndpoints = (endpoints: string[]): Promise<void> =>
    endpoints.length === 0 ? Promise.resolve() : mutate((s) => { s.subscriptions = s.subscriptions.filter((x) => !endpoints.includes(x.endpoint)); });

  async function deliver(state: State, sub: Subscription, payload: Uint8Array): Promise<"ok" | "gone" | "failed"> {
    const host = (() => {
      try {
        return new URL(sub.endpoint).host;
      } catch {
        return "an invalid endpoint";
      }
    })();
    try {
      const body = await encryptAes128gcm(payload, fromB64u(sub.p256dh) ?? new Uint8Array(), fromB64u(sub.auth) ?? new Uint8Array());
      const jwt = await vapidJwt(new URL(sub.endpoint).origin, state.vapid, now());
      const res = await send(sub.endpoint, {
        method: "POST",
        headers: { TTL: "3600", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", Authorization: `vapid t=${jwt}, k=${state.vapid.publicKey}` },
        body: concat(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.status === 404 || res.status === 410) return "gone";
      if (!res.ok) {
        log(`push to ${host} failed: ${String(res.status)}`);
        return "failed";
      }
      return "ok";
    } catch (e) {
      log(`push to ${host} failed: ${e instanceof Error ? e.message : String(e)}`);
      return "failed";
    }
  }

  return {
    publicKey: async () => (await loaded).vapid.publicKey,

    route: async (req, url) => {
      if (url.pathname === "/api/push/key" && req.method === "GET") {
        return Response.json({ publicKey: (await loaded).vapid.publicKey }, { headers: { "cache-control": "no-store" } });
      }
      if (url.pathname !== "/api/push/subscriptions") return null;
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        body = undefined;
      }
      if (req.method === "POST") {
        const checked = checkSubscription(body);
        if (!checked.ok) return Response.json({ error: `The subscription's ${checked.field} is not valid.` }, { status: 422 });
        const { sub } = checked;
        await mutate((s) => {
          const existing = s.subscriptions.find((x) => x.endpoint === sub.endpoint);
          if (existing) Object.assign(existing, sub, { token: fingerprint });
          else s.subscriptions.push({ ...sub, createdAt: now(), token: fingerprint });
          if (s.subscriptions.length > MAX_SUBSCRIPTIONS) {
            s.subscriptions = [...s.subscriptions].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_SUBSCRIPTIONS);
          }
        });
        return new Response(null, { status: 204 });
      }
      if (req.method === "DELETE") {
        const endpoint = isRecord(body) && typeof body.endpoint === "string" ? body.endpoint : null;
        if (endpoint === null) return Response.json({ error: "The subscription's endpoint is not valid." }, { status: 422 });
        await removeEndpoints([endpoint]);
        return new Response(null, { status: 204 });
      }
      return null;
    },

    jobDone: (job) => track((async () => {
      try {
        const state = await loaded;
        const stale = state.subscriptions.filter((s) => s.token !== fingerprint).map((s) => s.endpoint);
        const current = state.subscriptions.filter((s) => s.token === fingerprint);
        await removeEndpoints(stale);
        if (current.length === 0) return;
        const payload = enc.encode(JSON.stringify({ jobId: job.id, batchId: job.batch_id, name: notificationName(job) }));
        const results = await Promise.all(current.map(async (s) => [s.endpoint, await deliver(state, s, payload)] as const));
        await removeEndpoints(results.filter(([, r]) => r === "gone").map(([e]) => e));
      } catch (e) {
        log(`push for ${job.id} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })()),

    idle: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
      await chain;
      await loaded.catch(() => undefined);
    },
  };
}
