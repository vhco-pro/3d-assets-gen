import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The page is built from app/web into dist/web. The 3D viewer is its own entry so the page can import it
// on demand (and retry a failed import with a fresh URL); the server tells the page its URL. The service
// worker is a third entry with the fixed name sw.js, and app/web/public (manifest and icons) is copied as is.
export default defineConfig({
  root: "app/web",
  base: "/",
  // The page's own TypeScript settings. Without this, Vite follows tsconfig.json's references, which name
  // configs (the worker's, the phone scripts') that the image build does not copy.
  tsconfig: fileURLToPath(new URL("./tsconfig.web.json", import.meta.url)),
  plugins: [react(), tailwindcss()],
  // shadcn/ui components import from "@/", which is app/web.
  resolve: { alias: { "@": fileURLToPath(new URL("./app/web", import.meta.url)) } },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: { main: "app/web/index.html", viewer: "app/web/viewer.ts", sw: "app/web/sw.ts" },
      output: { entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"), chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});
