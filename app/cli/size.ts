// `bun run size`: the page's JavaScript budgets, measured on the Vite build in dist/web with gzip level 9.
// Initial load = the entry chunk, every chunk it imports statically, and every modulepreload link in
// index.html: at most 150 KiB. The viewer entry and its static imports: at most 350 KiB. The viewer must
// not be reachable from the initial load.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createReporter } from "./report.ts";

export const INITIAL_BUDGET = 150 * 1024;
export const VIEWER_BUDGET = 350 * 1024;

const STATIC_IMPORT = /(?:^|[;\s}])import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g;

function staticGraph(dist: string, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const rel = queue.pop() ?? "";
    if (seen.has(rel)) continue;
    seen.add(rel);
    const path = join(dist, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const m of text.matchAll(STATIC_IMPORT)) {
      const spec = m[1] ?? "";
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      const resolved = spec.startsWith("/") ? spec.slice(1) : join(dir, spec).replace(/^\.\//, "");
      queue.push(resolved);
    }
  }
  return seen;
}

const gz = (dist: string, rel: string): number => gzipSync(readFileSync(join(dist, rel)), { level: 9 }).length;

export interface SizeResult {
  ok: boolean;
  initial: number;
  viewer: number;
  problems: string[];
}

export function checkSize(dist: string): SizeResult {
  const problems: string[] = [];
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = /<script[^>]+type="module"[^>]+src="\/?([^"]+)"/.exec(html)?.[1];
  if (!entry) return { ok: false, initial: 0, viewer: 0, problems: ["index.html has no module entry script"] };
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+)"/g)].map((m) => m[1] ?? "");
  const initialFiles = new Set<string>([...staticGraph(dist, entry), ...preloads.flatMap((p) => [...staticGraph(dist, p)])]);
  const manifest = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8")) as Record<string, { file?: string; isEntry?: boolean }>;
  const viewerEntry = manifest["viewer.ts"]?.file;
  if (!viewerEntry) problems.push("the build has no viewer entry");
  const viewerFiles = viewerEntry ? staticGraph(dist, viewerEntry) : new Set<string>();
  if (viewerEntry && initialFiles.has(viewerEntry)) problems.push("the viewer is reachable from the initial load's static imports");
  const initial = [...initialFiles].reduce((n, f) => n + gz(dist, f), 0);
  const viewer = [...viewerFiles].filter((f) => !initialFiles.has(f)).reduce((n, f) => n + gz(dist, f), 0);
  if (initial > INITIAL_BUDGET) problems.push(`initial JavaScript is ${(initial / 1024).toFixed(1)} KiB gzipped, over 150 KiB`);
  if (viewer > VIEWER_BUDGET) problems.push(`viewer JavaScript is ${(viewer / 1024).toFixed(1)} KiB gzipped, over 350 KiB`);
  return { ok: problems.length === 0, initial, viewer, problems };
}

if (import.meta.main) {
  const report = createReporter();
  const dist = join(import.meta.dir, "..", "..", "dist", "web");
  const r = checkSize(dist);
  report.step(`initial ${(r.initial / 1024).toFixed(1)} KiB, viewer ${(r.viewer / 1024).toFixed(1)} KiB (gzip level 9)`);
  for (const p of r.problems) report.fail(p);
  if (r.ok) report.pass("bundle budgets met");
  process.exit(r.ok ? 0 : 1);
}
