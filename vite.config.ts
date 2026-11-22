import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The page is built from app/web into dist/web. The 3D viewer is its own entry so the page can import it
// on demand (and retry a failed import with a fresh URL); the server tells the page its URL.
export default defineConfig({
  root: "app/web",
  base: "/",
  plugins: [react(), tailwindcss()],
  // shadcn/ui components import from "@/", which is app/web.
  resolve: { alias: { "@": fileURLToPath(new URL("./app/web", import.meta.url)) } },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: { main: "app/web/index.html", viewer: "app/web/viewer.ts" },
      output: { entryFileNames: "assets/[name]-[hash].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name]-[hash][extname]" },
    },
  },
});
