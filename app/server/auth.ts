// Access token checks, session cookies and the failed-authentication limiter.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const SESSION_COOKIE = "session";
export const SESSION_SECONDS = 30 * 24 * 3600;
const LIMIT = 10;
const WINDOW_MS = 60_000;

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function mac(token: string, issuedAt: number): string {
  return createHmac("sha256", token).update(`asset-studio-session-v1.${String(issuedAt)}`).digest("base64url");
}

export function makeCookieValue(token: string, issuedAt: number): string {
  return `${String(issuedAt)}.${mac(token, issuedAt)}`;
}

/** True when the cookie value was issued with this token within the last 30 days and not in the future. */
export function verifyCookieValue(token: string, value: string, nowMs: number): boolean {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  const nowS = Math.floor(nowMs / 1000);
  if (issuedAt > nowS + 60 || nowS - issuedAt > SESSION_SECONDS) return false;
  return sameSecret(mac(token, issuedAt), m[2] ?? "");
}

export function sessionCookieHeader(value: string): string {
  return `${SESSION_COOKIE}=${value}; Max-Age=${String(SESSION_SECONDS)}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function normalise(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * The client a request is counted against: the last X-Forwarded-For value when the socket peer is trusted
 * and sends the header, otherwise the socket address.
 */
export function clientAddress(peer: string, forwardedFor: string | null, trusted: ReadonlySet<string>): string {
  const p = normalise(peer);
  if (forwardedFor && trusted.has(p)) {
    const last = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return normalise(last);
  }
  return p;
}

/** Loopback addresses plus the container's default gateway from /proc/net/route, when readable. */
export function defaultTrustedPeers(routeFile = "/proc/net/route"): Set<string> {
  const peers = new Set(["127.0.0.1", "::1"]);
  try {
    for (const line of readFileSync(routeFile, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols[1] === "00000000" && cols[2] && cols[2] !== "00000000") {
        const hex = cols[2];
        const bytes = [6, 4, 2, 0].map((i) => parseInt(hex.slice(i, i + 2), 16));
        peers.add(bytes.join("."));
      }
    }
  } catch {
    // Not in a container or no procfs: loopback only.
  }
  return peers;
}

/** Sliding 60-second window of failed authentications per client. */
export class FailureLimiter {
  private failures = new Map<string, number[]>();
  constructor(private now: () => number) {}

  private recent(client: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const list = (this.failures.get(client) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(client, list);
    else this.failures.delete(client);
    return list;
  }

  overLimit(client: string): boolean {
    return this.recent(client).length >= LIMIT;
  }

  record(client: string): void {
    const list = this.recent(client);
    list.push(this.now());
    this.failures.set(client, list);
  }
}
