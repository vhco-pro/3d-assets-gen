// Shared helpers for server tests: temporary config, data and ComfyUI folders, and image fixtures.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";

export const TEST_TOKEN = "dGVzdC10b2tlbi1mb3ItYXNzZXQtc3R1ZGlvLXVuaXQtdGVzdHM";

export interface TestDirs {
  root: string;
  config: Config;
  cleanup(): void;
}

export function testDirs(overrides: Partial<Config> = {}): TestDirs {
  const root = mkdtempSync(join(tmpdir(), "asset-studio-test-"));
  const comfy = join(root, "comfy");
  const config: Config = {
    listen: "127.0.0.1:0",
    comfyuiUrl: "http://127.0.0.1:1",
    dataDir: join(root, "data"),
    comfyInputDir: join(comfy, "input", "asset-studio"),
    comfyOutputDir: join(comfy, "output", "asset-studio"),
    token: TEST_TOKEN,
    limits: { batchJobs: 25, batchImageBytes: 200 * 1024 * 1024, unfinishedJobs: 100 },
    ...overrides,
  };
  mkdirSync(config.comfyInputDir, { recursive: true });
  mkdirSync(config.comfyOutputDir, { recursive: true });
  return { root, config, cleanup: () => { rmSync(root, { recursive: true, force: true }); } };
}

const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff, 0xe0],
  webp: [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
} as const;

/** Bytes that start with the format's signature and are padded to `size`. */
export function imageBytes(kind: keyof typeof MAGIC, size = 1024, fill = 7): Uint8Array {
  const out = new Uint8Array(size).fill(fill);
  out.set(MAGIC[kind]);
  return out;
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${TEST_TOKEN}`, ...extra };
}
