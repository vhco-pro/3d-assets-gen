import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify as verifySig } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeComfy } from "../fake-comfy/fake.ts";
import { ComfyClient, type HistoryEntry } from "./comfy.ts";
import { createServer, type RunningServer } from "./http.ts";
import { getJob, type JobRow } from "./jobs.ts";
import { createPush, encryptAes128gcm, VAPID_SUBJECT, vapidJwt, type Push } from "./push.ts";
import { openStore, type Store } from "./store.ts";
import { authHeaders, TEST_TOKEN, testDirs, type TestDirs } from "./testkit.ts";
import { Tracker } from "./tracker.ts";

const b64 = (s: string): Buffer => Buffer.from(s, "base64url");
const hmac = (key: Uint8Array, data: Uint8Array): Buffer => createHmac("sha256", key).update(data).digest();

/** A browser's subscription: its own P-256 key pair and auth secret, decrypting what the push service gets. */
class Subscriber {
  readonly ecdh = createECDH("prime256v1");
  readonly auth: Buffer;
  constructor(readonly endpoint: string, privateKey?: Buffer, auth?: Buffer) {
    if (privateKey) this.ecdh.setPrivateKey(privateKey);
    else this.ecdh.generateKeys();
    this.auth = auth ?? Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  }
  get publicKey(): Buffer {
    return this.ecdh.getPublicKey();
  }
  json(): { endpoint: string; keys: { p256dh: string; auth: string } } {
    return { endpoint: this.endpoint, keys: { p256dh: this.publicKey.toString("base64url"), auth: this.auth.toString("base64url") } };
  }
  /** RFC 8291 decryption of an aes128gcm body, written independently of the sender. */
  decrypt(body: Uint8Array): { plaintext: Buffer; senderKey: Buffer; rs: number } {
    const buf = Buffer.from(body);
    const salt = buf.subarray(0, 16);
    const rs = buf.readUInt32BE(16);
    const idlen = buf[20] ?? 0;
    const senderKey = buf.subarray(21, 21 + idlen);
    const ciphertext = buf.subarray(21 + idlen);
    const ecdhSecret = this.ecdh.computeSecret(senderKey);
    const prkKey = hmac(this.auth, ecdhSecret);
    const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), this.publicKey, senderKey, Buffer.from([1])]));
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end--;
    expect(padded[end]).toBe(2);
    return { plaintext: padded.subarray(0, end), senderKey, rs };
  }
}

interface Sent {
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** The local fake push service: records each POST and answers with the status set for its endpoint. */
function fakePushService(): { sent: Sent[]; status: Map<string, number>; fetch: typeof fetch } {
  const sent: Sent[] = [];
  const status = new Map<string, number>();
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    sent.push({ url: req.url, headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) });
    return new Response(null, { status: status.get(req.url) ?? 201 });
  };
  return { sent, status, fetch: fake as typeof fetch };
}

function fakeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: crypto.randomUUID(), batch_id: crypto.randomUUID(), position: 0, kind: "prompt", prompt: "a wooden chest", upload_name: null, upload_ext: null,
    engine: "trellis", shared_style: null, queued_at: 1, faces: 10000, tex: 2048, style: 1, seed: 1, state: "done", prompt_id: null, posted_at: null,
    attempts: 1, losses: 0, server_errors: 0, cancel_requested: 0, fixture: 0, error: null, created_at: 1, started_at: 1, finished_at: 2, ...overrides,
  };
}

let dirs: TestDirs;
let service: ReturnType<typeof fakePushService>;
const pushes: Push[] = [];
function push(token = TEST_TOKEN): Push {
  const p = createPush({ dataDir: dirs.config.dataDir, token, fetch: service.fetch, log: () => undefined });
  pushes.push(p);
  return p;
}
async function subscribe(p: Push, sub: Subscriber): Promise<Response> {
  const res = await p.route(new Request("http://app/api/push/subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.json()) }), new URL("http://app/api/push/subscriptions"));
  if (!res) throw new Error("no route");
  return res;
}
const stored = (): { endpoint: string }[] => (JSON.parse(readFileSync(join(dirs.config.dataDir, "push.json"), "utf8")) as { subscriptions: { endpoint: string }[] }).subscriptions;

beforeEach(() => {
  dirs = testDirs();
  service = fakePushService();
});
afterEach(async () => {
  for (const p of pushes.splice(0)) await p.idle();
  dirs.cleanup();
});

describe("RFC 8291 and RFC 8292", () => {
  // RFC 8291 section 5.
  const asPrivate = b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
  const asPublic = b64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const uaPrivate = b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94");
  const uaPublic = b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
  const auth = b64("BTBZMqHH6r4Tts7J_aSIgg");
  const salt = b64("DGv6ra1nlYgDCS1FRnbzlw");
  const body = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
  const plaintext = "When I grow up, I want to be a watermelon";

  test("the section 5 example encrypts to the published message", async () => {
    const out = await encryptAes128gcm(new TextEncoder().encode(plaintext), uaPublic, auth, { asPrivate, asPublic, salt, rs: 4096 });
    expect(Buffer.from(out).toString("base64url")).toBe(body);
    // The test's own decryption agrees with the published example.
    const ua = new Subscriber("https://push.example/x", uaPrivate, auth);
    expect(ua.publicKey.toString("base64url")).toBe(uaPublic.toString("base64url"));
    expect(ua.decrypt(b64(body)).plaintext.toString()).toBe(plaintext);
  });

  test("the VAPID JWT verifies with the public key and names the fixed subject", async () => {
    const p = push();
    const publicKey = b64(await p.publicKey());
    const keys = JSON.parse(readFileSync(join(dirs.config.dataDir, "push.json"), "utf8")) as { vapid: { publicKey: string; privateKey: string } };
    const jwt = await vapidJwt("https://fcm.googleapis.com", keys.vapid, 1_800_000_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(b64(h ?? "").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(b64(c ?? "").toString()) as { aud: string; exp: number; sub: string };
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: VAPID_SUBJECT });
    expect(VAPID_SUBJECT).toBe("https://github.com/vhco-pro/3d-assets-gen");
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: publicKey.subarray(1, 33).toString("base64url"), y: publicKey.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verifySig("sha256", Buffer.from(`${h ?? ""}.${c ?? ""}`), { key, dsaEncoding: "ieee-p1363" }, b64(s ?? ""))).toBe(true);
  });
});

describe("subscriptions and sending", () => {
  test("a job done sends one encrypted message that decrypts to the job, batch and name", async () => {
    const p = push();
    const sub = new Subscriber("https://fcm.googleapis.com/fcm/send/abc");
    expect((await subscribe(p, sub)).status).toBe(204);
    const job = fakeJob();
    await p.jobDone(job);
    expect(service.sent).toHaveLength(1);
    const msg = service.sent[0];
    if (!msg) throw new Error("nothing sent");
    expect(msg.url).toBe(sub.endpoint);
    expect(msg.headers.get("content-encoding")).toBe("aes128gcm");
    expect(msg.headers.get("ttl")).toBe("3600");
    expect(msg.headers.get("urgency")).toBe("normal");
    expect(msg.headers.get("authorization")).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${await p.publicKey()}$`));
    const { plaintext, senderKey } = sub.decrypt(msg.body);
    expect(JSON.parse(plaintext.toString())).toEqual({ jobId: job.id, batchId: job.batch_id, name: "a wooden chest" });
    expect(senderKey.length).toBe(65);
  });

  test("an image job's name is its file name", async () => {
    const p = push();
    const sub = new Subscriber("https://fcm.googleapis.com/fcm/send/img");
    await subscribe(p, sub);
    await p.jobDone(fakeJob({ kind: "image", prompt: null, upload_name: "old-chest.png" }));
    expect((JSON.parse(sub.decrypt(service.sent[0]?.body ?? new Uint8Array()).plaintext.toString()) as { name: string }).name).toBe("old-chest.png");
  });

  test("a 410 deletes the subscription; another failure keeps it", async () => {
    const p = push();
    const gone = new Subscriber("https://fcm.googleapis.com/fcm/send/gone");
    const flaky = new Subscriber("https://web.push.apple.com/flaky");
    await subscribe(p, gone);
    await subscribe(p, flaky);
    service.status.set(gone.endpoint, 410);
    service.status.set(flaky.endpoint, 500);
    await p.jobDone(fakeJob());
    await p.idle();
    expect(stored().map((s) => s.endpoint)).toEqual([flaky.endpoint]);
  });

  test("a subscription saved under an old token gets nothing and is deleted", async () => {
    const before = push(TEST_TOKEN);
    await subscribe(before, new Subscriber("https://fcm.googleapis.com/fcm/send/old"));
    await before.idle();
    const after = push("cm90YXRlZC10b2tlbi1mb3ItYXNzZXQtc3R1ZGlvLXVuaXQtdGVzdA");
    await after.jobDone(fakeJob());
    await after.idle();
    expect(service.sent).toHaveLength(0);
    expect(stored()).toEqual([]);
  });

  test("an invalid body answers 422 naming the field", async () => {
    const p = push();
    const good = new Subscriber("https://fcm.googleapis.com/fcm/send/ok").json();
    const cases: [unknown, string][] = [
      [{ ...good, endpoint: "http://fcm.googleapis.com/fcm/send/ok" }, "endpoint"],
      [{ ...good, endpoint: 7 }, "endpoint"],
      [{ ...good, keys: { ...good.keys, p256dh: Buffer.alloc(64, 4).toString("base64url") } }, "keys.p256dh"],
      [{ ...good, keys: { ...good.keys, auth: Buffer.alloc(8).toString("base64url") } }, "keys.auth"],
      [{ endpoint: good.endpoint }, "keys.p256dh"],
    ];
    for (const [body, field] of cases) {
      const res = await p.route(new Request("http://app/api/push/subscriptions", { method: "POST", body: JSON.stringify(body) }), new URL("http://app/api/push/subscriptions"));
      expect(res?.status).toBe(422);
      expect(((await res?.json()) as { error: string }).error).toContain(field);
    }
    expect(existsSync(join(dirs.config.dataDir, "push.json")) ? stored() : []).toEqual([]);
  });

  test("a 2000-character CJK prompt gives a payload under 3993 bytes holding its first 80 characters", async () => {
    const p = push();
    const sub = new Subscriber("https://fcm.googleapis.com/fcm/send/cjk");
    await subscribe(p, sub);
    const prompt = "木箱🗝".repeat(667).slice(0, 2000);
    await p.jobDone(fakeJob({ prompt }));
    const { plaintext } = sub.decrypt(service.sent[0]?.body ?? new Uint8Array());
    expect(plaintext.length).toBeLessThan(3993);
    expect((JSON.parse(plaintext.toString()) as { name: string }).name).toBe([...prompt].slice(0, 80).join(""));
  });

  test("subscribing is an upsert by endpoint, keeps at most 20 and DELETE removes one", async () => {
    const p = push();
    const subs = Array.from({ length: 22 }, (_, i) => new Subscriber(`https://fcm.googleapis.com/fcm/send/${String(i)}`));
    for (const s of subs) await subscribe(p, s);
    await subscribe(p, subs[21] ?? subs[0] ?? new Subscriber("https://x.test/"));
    await p.idle();
    expect(stored().map((s) => s.endpoint)).toEqual(subs.slice(2).map((s) => s.endpoint));
    const del = await p.route(new Request("http://app/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subs[5]?.endpoint }) }), new URL("http://app/api/push/subscriptions"));
    expect(del?.status).toBe(204);
    const again = await p.route(new Request("http://app/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: "https://never.test/" }) }), new URL("http://app/api/push/subscriptions"));
    expect(again?.status).toBe(204);
    expect(stored().map((s) => s.endpoint)).not.toContain(subs[5]?.endpoint);
  });

  test("concurrent subscribe and delete calls leave a valid file", async () => {
    const p = push();
    const subs = Array.from({ length: 12 }, (_, i) => new Subscriber(`https://fcm.googleapis.com/fcm/send/c${String(i)}`));
    await Promise.all(subs.map((s) => subscribe(p, s)));
    await Promise.all([
      ...subs.slice(0, 6).map((s) => p.route(new Request("http://app/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: s.endpoint }) }), new URL("http://app/api/push/subscriptions"))),
      ...subs.slice(6).map((s) => subscribe(p, s)),
    ]);
    await p.idle();
    expect(stored().map((s) => s.endpoint).sort()).toEqual(subs.slice(6).map((s) => s.endpoint).sort());
  });

  test("reload: a new instance on an existing push.json sends with the stored keys to the stored subscription", async () => {
    const first = push();
    const sub = new Subscriber("https://fcm.googleapis.com/fcm/send/kept");
    await subscribe(first, sub);
    const key = await first.publicKey();
    await first.idle();
    const second = push();
    expect(await second.publicKey()).toBe(key);
    await second.jobDone(fakeJob());
    expect(service.sent).toHaveLength(1);
    expect(sub.decrypt(service.sent[0]?.body ?? new Uint8Array()).senderKey.length).toBe(65);
    expect(service.sent[0]?.headers.get("authorization")).toContain(`k=${key}`);
  });

  test("a corrupt push.json starts empty with new keys", async () => {
    const first = push();
    const key = await first.publicKey();
    await first.idle();
    await Bun.write(join(dirs.config.dataDir, "push.json"), "{not json");
    expect(await push().publicKey()).not.toBe(key);
  });
});

describe("routes behind the session", () => {
  let srv: RunningServer;
  afterEach(async () => {
    await srv.stop();
  });
  test("GET /api/push/key answers the public key with the token and 401 without", async () => {
    const p = push();
    srv = createServer(dirs.config, { tracker: false, routes: { api: (req, url) => p.route(req, url) } });
    expect((await fetch(`${srv.url}/api/push/key`)).status).toBe(401);
    expect((await fetch(`${srv.url}/api/push/subscriptions`, { method: "POST", body: "{}" })).status).toBe(401);
    const res = await fetch(`${srv.url}/api/push/key`, { headers: authHeaders() });
    expect(await res.json()).toEqual({ publicKey: await p.publicKey() });
  });
});

describe("the tracker notifies once per job", () => {
  let fake: FakeComfy;
  let store: Store;
  beforeEach(() => {
    fake = new FakeComfy({ outputDir: join(dirs.root, "comfy", "output"), inputDir: join(dirs.root, "comfy", "input"), runMs: 30 });
    fake.start();
    dirs.config.comfyuiUrl = fake.url;
    store = openStore(dirs.config.dataDir);
  });
  afterEach(() => {
    fake.stop();
    store.close();
  });

  test("a job marked done sends one message; a later done update that changes no row sends nothing", async () => {
    const p = push();
    const sub = new Subscriber("https://fcm.googleapis.com/fcm/send/tracker");
    await subscribe(p, sub);
    const batch = crypto.randomUUID();
    const id = crypto.randomUUID();
    store.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES (?, 'prompt', '{}', ?, 1)", [batch, batch]);
    store.db.run(
      `INSERT INTO jobs (id, batch_id, position, kind, prompt, engine, faces, tex, style, seed, state, created_at, queued_at)
       VALUES (?, ?, 0, 'prompt', 'a mossy well', 'trellis', 10000, 2048, 1, 1, 'pending', 1, 1)`,
      [id, batch],
    );
    const pending = getJob(store, id);
    const t = new Tracker({ store, config: dirs.config, comfy: new ComfyClient(fake.url, { timeoutMs: 10_000 }), onDone: (job) => { void p.jobDone(job); } });
    for (let i = 0; i < 200 && getJob(store, id)?.state !== "done"; i++) {
      await t.tick();
      await Bun.sleep(15);
    }
    expect(getJob(store, id)?.state).toBe("done");
    await p.idle();
    expect(service.sent).toHaveLength(1);
    expect((JSON.parse(sub.decrypt(service.sent[0]?.body ?? new Uint8Array()).plaintext.toString()) as { jobId: string }).jobId).toBe(id);
    // A second collection with the stale row: its update expects 'pending' and changes nothing.
    if (!pending) throw new Error("no job");
    await t["collect"](pending, { files: [] } as unknown as HistoryEntry);
    await p.idle();
    expect(service.sent).toHaveLength(1);
  });
});
