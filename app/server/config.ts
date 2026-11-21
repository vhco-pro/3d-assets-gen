// Strict loader for config.yaml. Unknown keys, wrong types and malformed tokens are errors.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface Limits {
  batchJobs: number;
  batchImageBytes: number;
  unfinishedJobs: number;
}
export interface Config {
  listen: string;
  comfyuiUrl: string;
  dataDir: string;
  comfyInputDir: string;
  comfyOutputDir: string;
  token: string;
  limits: Limits;
}

export class ConfigError extends Error {}

const TOKEN = /^[A-Za-z0-9_-]{43,}$/;
const TOP = new Set(["listen", "comfyui_url", "data_dir", "comfy_input_dir", "comfy_output_dir", "token", "limits"]);
const LIMITS = new Set(["batch_jobs", "batch_image_bytes", "unfinished_jobs"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v !== "string" || v.length === 0) throw new ConfigError(`${key} must be a non-empty string`);
  return v;
}

function posInt(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new ConfigError(`limits.${key} must be a positive integer`);
  return v;
}

export function parseConfig(text: string): Config {
  let raw: unknown;
  try {
    raw = parse(text, { strict: true, uniqueKeys: true });
  } catch (e) {
    throw new ConfigError(`config.yaml is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isRecord(raw)) throw new ConfigError("config.yaml must be a mapping");
  for (const k of Object.keys(raw)) if (!TOP.has(k)) throw new ConfigError(`unknown key: ${k}`);
  const limitsRaw = raw.limits ?? {};
  if (!isRecord(limitsRaw)) throw new ConfigError("limits must be a mapping");
  for (const k of Object.keys(limitsRaw)) if (!LIMITS.has(k)) throw new ConfigError(`unknown key: limits.${k}`);
  const token = raw.token;
  if (typeof token !== "string" || !TOKEN.test(token)) {
    throw new ConfigError("token must be at least 43 base64url characters (32 random bytes, no padding)");
  }
  return {
    listen: str(raw, "listen", "0.0.0.0:8790"),
    comfyuiUrl: str(raw, "comfyui_url", "http://host.docker.internal:8188"),
    dataDir: str(raw, "data_dir", "/data"),
    comfyInputDir: str(raw, "comfy_input_dir", "/comfy/input"),
    comfyOutputDir: str(raw, "comfy_output_dir", "/comfy/output"),
    token,
    limits: {
      batchJobs: posInt(limitsRaw, "batch_jobs", 25),
      batchImageBytes: posInt(limitsRaw, "batch_image_bytes", 200 * 1024 * 1024),
      unfinishedJobs: posInt(limitsRaw, "unfinished_jobs", 100),
    },
  };
}

export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parseConfig(text);
}
