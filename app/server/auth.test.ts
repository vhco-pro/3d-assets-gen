import { afterEach, beforeEach, expect, test } from "bun:test";
import { clientAddress, makeCookieValue } from "./auth.ts";
import { createServer, type RunningServer } from "./http.ts";
import { TEST_TOKEN, testDirs, type TestDirs } from "./testkit.ts";

let dirs: TestDirs;
let srv: RunningServer;
let now = 1_800_000_000_000;
beforeEach(() => {
  now = 1_800_000_000_000;
  dirs = testDirs();
  srv = createServer(dirs.config, { tracker: false, now: () => now });
});
afterEach(async () => {
  await srv.stop();
  dirs.cleanup();
});

const PROTECTED: [string, string][] = [
  ["GET", "/api/jobs"],
  ["GET", `/api/jobs/${crypto.randomUUID()}`],
  ["POST", `/api/jobs/${crypto.randomUUID()}/cancel`],
  ["POST", `/api/jobs/${crypto.randomUUID()}/retry`],
  ["DELETE", `/api/jobs/${crypto.randomUUID()}`],
  ["GET", `/api/assets/${crypto.randomUUID()}/model.glb`],
  ["GET", `/api/assets/${crypto.randomUUID()}/source`],
  ["GET", `/api/assets/${crypto.randomUUID()}/thumb`],
  ["POST", "/api/exports"],
  ["GET", `/api/exports/${crypto.randomUUID()}`],
  ["POST", "/api/batches"],
];

async function call(method: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(srv.url + path, { method, headers, redirect: "manual" });
}

async function signIn(token: string, xff?: string): Promise<Response> {
  return fetch(`${srv.url}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(xff ? { "x-forwarded-for": xff } : {}) },
    body: JSON.stringify({ token }),
  });
}

test("health is public and reveals only version, commit and ComfyUI state", async () => {
  const res = await call("GET", "/api/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["comfyui", "comfyuiVersion", "commit", "version"]);
});

test("every protected route refuses missing, wrong and forged credentials and accepts the bearer token", async () => {
  for (const [method, path] of PROTECTED) {
    expect((await call(method, path)).status).toBe(401);
    expect((await call(method, path, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call(method, path, { cookie: `session=${String(Math.floor(now / 1000))}.forged` })).status).toBe(401);
    expect((await call(method, path, { authorization: `Bearer ${TEST_TOKEN}` })).status).not.toBe(401);
  }
});

test("sign-in sets a 30-day session cookie that works, expires after 30 days and rejects future issue times", async () => {
  const res = await signIn(TEST_TOKEN);
  expect(res.status).toBe(204);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/Max-Age=2592000/);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/Secure/);
  expect(cookie).toMatch(/SameSite=Strict/);
  const value = /session=([^;]+)/.exec(cookie)?.[1] ?? "";
  expect((await call("GET", "/api/jobs", { cookie: `session=${value}` })).status).toBe(200);
  now += 30 * 24 * 3600 * 1000 + 1000;
  expect((await call("GET", "/api/jobs", { cookie: `session=${value}` })).status).toBe(401);
  const future = makeCookieValue(TEST_TOKEN, Math.floor(now / 1000) + 3600);
  expect((await call("GET", "/api/jobs", { cookie: `session=${future}` })).status).toBe(401);
});

test("failed authentications from one forwarded client are limited together; others and correct tokens still pass", async () => {
  const a = "100.64.0.1";
  for (let i = 0; i < 4; i++) expect((await signIn("wrong", a)).status).toBe(401);
  for (let i = 0; i < 3; i++) expect((await call("GET", "/api/jobs", { authorization: "Bearer nope", "x-forwarded-for": a })).status).toBe(401);
  for (let i = 0; i < 3; i++) expect((await call("GET", "/api/jobs", { cookie: "session=1.bad", "x-forwarded-for": a })).status).toBe(401);
  expect((await signIn("wrong", a)).status).toBe(429);
  expect((await signIn("wrong", "100.64.0.2")).status).toBe(401);
  expect((await signIn(TEST_TOKEN, a)).status).toBe(204);
  now += 61_000;
  expect((await signIn("wrong", a)).status).toBe(401);
});

test("the client address comes from X-Forwarded-For only for trusted peers that send it", () => {
  const trusted = new Set(["127.0.0.1", "::1", "172.18.0.1"]);
  expect(clientAddress("172.18.0.1", "10.0.0.1, 100.64.0.9", trusted)).toBe("100.64.0.9");
  expect(clientAddress("127.0.0.1", null, trusted)).toBe("127.0.0.1");
  expect(clientAddress("192.168.1.5", "100.64.0.9", trusted)).toBe("192.168.1.5");
  expect(clientAddress("::ffff:127.0.0.1", "100.64.0.3", trusted)).toBe("100.64.0.3");
});
