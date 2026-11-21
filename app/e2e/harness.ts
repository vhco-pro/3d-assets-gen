// Starts an Asset Studio stack for the browser suite: the fake ComfyUI as a process, and the server either
// as the built container image (E2E_TARGET=image, the default, as `bun run verify` runs it) or from source
// (E2E_TARGET=source, for working on the page before an image exists). Each stack owns a temporary root
// under .artifacts/e2e with its data directory and the fake's ComfyUI folders.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
export const TARGET = process.env.E2E_TARGET === "source" ? "source" : "image";
export const IMAGE = process.env.E2E_IMAGE ?? "asset-studio:local";

export type Profile = "default" | "empty";

export interface Stack {
  name: string;
  url: string;
  token: string;
  root: string;
  fakeUrl: string;
  control(action: string, extra?: Record<string, string>): Promise<void>;
  stopFake(): Promise<void>;
  startFake(): Promise<void>;
  /** Restarts the server with a new token (token rotation). */
  rotateToken(): Promise<string>;
  stop(): Promise<void>;
}

async function freePort(host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => { resolve(port); });
    });
  });
}

function dockerGateway(): string {
  return execFileSync("docker", ["network", "inspect", "bridge", "-f", "{{(index .IPAM.Config 0).Gateway}}"]).toString().trim();
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${what} did not become ready within ${String(ms / 1000)} s`);
}

const newToken = (): string => randomBytes(32).toString("base64url");

export async function startStack(name: string, profile: Profile): Promise<Stack> {
  const root = join(ROOT, ".artifacts", "e2e", `${name}-${randomBytes(3).toString("hex")}`);
  const dataDir = join(root, "data");
  const comfyIn = join(root, "comfy", "input", "asset-studio");
  const comfyOut = join(root, "comfy", "output", "asset-studio");
  for (const d of [dataDir, comfyIn, comfyOut]) {
    mkdirSync(d, { recursive: true });
    chmodSync(d, 0o777);
  }
  chmodSync(join(root, "comfy", "input"), 0o777);
  chmodSync(join(root, "comfy", "output"), 0o777);
  const fakeHost = TARGET === "image" ? dockerGateway() : "127.0.0.1";
  const fakePort = await freePort(fakeHost);
  const appPort = await freePort();
  let token = newToken();
  const comfyUrlForApp = TARGET === "image" ? `http://host.docker.internal:${String(fakePort)}` : `http://127.0.0.1:${String(fakePort)}`;
  const configPath = join(root, "config.yaml");
  const writeConfig = (): void => {
    const lines = TARGET === "image"
      ? [`comfyui_url: ${comfyUrlForApp}`, `token: ${token}`]
      : [`listen: 127.0.0.1:${String(appPort)}`, `comfyui_url: ${comfyUrlForApp}`, `data_dir: ${dataDir}`, `comfy_input_dir: ${comfyIn}`, `comfy_output_dir: ${comfyOut}`, `token: ${token}`];
    writeFileSync(configPath, lines.join("\n") + "\n");
    chmodSync(configPath, 0o644);
  };
  writeConfig();

  let fake: ChildProcess | null = null;
  const fakeUrl = `http://${fakeHost}:${String(fakePort)}`;
  const startFake = async (): Promise<void> => {
    fake = spawn("bun", [join(ROOT, "app/fake-comfy/main.ts"), "--port", String(fakePort), "--host", fakeHost, "--comfy", join(root, "comfy"), "--data", dataDir], { stdio: "ignore" });
    await waitFor(async () => (await fetch(`${fakeUrl}/asset-studio-fake`)).ok, "fake ComfyUI");
  };
  const stopFake = async (): Promise<void> => {
    const p = fake;
    fake = null;
    if (!p) return;
    await new Promise<void>((resolve) => {
      p.once("exit", () => { resolve(); });
      p.kill();
    });
  };
  await startFake();

  const container = `asset-studio-e2e-${name}-${randomBytes(3).toString("hex")}`;
  const mounts = ["-v", `${dataDir}:/data`, "-v", `${comfyIn}:/comfy/input`, "-v", `${comfyOut}:/comfy/output`, "-v", `${configPath}:/config/config.yaml:ro`];
  const imageArgs = ["--read-only", "--tmpfs", "/tmp", "--user", "65532:65532", "--add-host", "host.docker.internal:host-gateway", ...mounts];
  let server: ChildProcess | null = null;

  const seed = (): void => {
    if (TARGET === "image") execFileSync("docker", ["run", "--rm", ...imageArgs, IMAGE, "seed", "--config", "/config/config.yaml", "--profile", profile], { stdio: "ignore" });
    else execFileSync("bun", [join(ROOT, "app/server/main.ts"), "seed", "--config", configPath, "--profile", profile], { stdio: "ignore" });
  };
  const startServer = async (): Promise<void> => {
    if (TARGET === "image") {
      execFileSync("docker", ["run", "-d", "--name", container, "-p", `127.0.0.1:${String(appPort)}:8790`, ...imageArgs, IMAGE], { stdio: "ignore" });
    } else {
      server = spawn("bun", [join(ROOT, "app/server/main.ts"), "serve", "--config", configPath], { stdio: "ignore" });
    }
    await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${String(appPort)}/api/health`);
      return res.ok && ((await res.json()) as { comfyui?: string }).comfyui === "reachable";
    }, "Asset Studio");
  };
  const stopServer = async (): Promise<void> => {
    if (TARGET === "image") {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // already gone
      }
      return;
    }
    const p = server;
    server = null;
    if (!p) return;
    await new Promise<void>((resolve) => {
      p.once("exit", () => { resolve(); });
      p.kill();
    });
  };

  seed();
  await startServer();
  return {
    name,
    url: `http://127.0.0.1:${String(appPort)}`,
    get token() {
      return token;
    },
    root,
    fakeUrl,
    control: async (action, extra = {}) => {
      const res = await fetch(`${fakeUrl}/_control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      if (!res.ok) throw new Error(`fake control ${action} failed`);
    },
    stopFake,
    startFake,
    rotateToken: async () => {
      await stopServer();
      token = newToken();
      writeConfig();
      await startServer();
      return token;
    },
    stop: async () => {
      await stopServer();
      await stopFake();
      if (!process.env.E2E_KEEP) rmSync(root, { recursive: true, force: true });
    },
  };
}

export const SHARED_FILE = join(ROOT, ".artifacts", "e2e", "shared.json");
