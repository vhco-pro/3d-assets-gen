// Serves the built page from dist/web (or, in the compiled executable, from the embedded copy).
// The page's HTML gets a <meta name="viewer-src"> with the viewer entry's URL from Vite's manifest.
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { embedded } from "./embedded.ts";

const DIST = join(import.meta.dir, "..", "..", "dist", "web");
/** Files of app/web/public served at the root by exact name: [content type, cache-control]. */
const ROOT_FILES: Record<string, [string, string]> = {
  "manifest.webmanifest": ["application/manifest+json", "no-cache"],
  "sw.js": ["text/javascript", "no-cache"],
  "icon-192.png": ["image/png", "public, max-age=86400"],
  "icon-512.png": ["image/png", "public, max-age=86400"],
  "icon-maskable-512.png": ["image/png", "public, max-age=86400"],
  "apple-touch-icon.png": ["image/png", "public, max-age=86400"],
};
const TYPES: Record<string, string> = { js: "text/javascript", css: "text/css", html: "text/html; charset=utf-8", svg: "image/svg+xml", png: "image/png", json: "application/json" };

function fileFor(rel: string): Blob | null {
  const hit = embedded[rel];
  if (hit) return Bun.file(hit);
  const path = normalize(join(DIST, rel));
  if (!path.startsWith(DIST) || !existsSync(path)) return null;
  return Bun.file(path);
}

let html: string | null = null;
async function indexHtml(): Promise<string | null> {
  if (html) return html;
  const index = fileFor("index.html");
  const manifestFile = fileFor(".vite/manifest.json");
  if (!index) return null;
  let page = await index.text();
  if (manifestFile) {
    const manifest = JSON.parse(await manifestFile.text()) as Record<string, { file?: string }>;
    const viewer = manifest["viewer.ts"]?.file;
    if (viewer) page = page.replace("</head>", `  <meta name="viewer-src" content="/${viewer}" />\n  </head>`);
  }
  html = page;
  return page;
}

export async function pageRoute(_req: Request, url: URL): Promise<Response> {
  const rel = url.pathname.replace(/^\/+/, "");
  if (rel.startsWith("assets/")) {
    const file = fileFor(rel);
    if (!file) return new Response("Not found", { status: 404 });
    const ext = rel.slice(rel.lastIndexOf(".") + 1);
    return new Response(file, { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  }
  const root = ROOT_FILES[rel];
  if (root) {
    const file = fileFor(rel);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(file, { headers: { "content-type": root[0], "cache-control": root[1] } });
  }
  const page = await indexHtml();
  if (!page) return new Response("The page has not been built; run bun run build:web.", { status: 503 });
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
