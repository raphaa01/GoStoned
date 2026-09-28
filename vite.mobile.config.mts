import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: resolve("./mobile"),
  publicDir: resolve("./.mobile-assets"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: "next/navigation", replacement: resolve("./mobile/src/next-navigation.ts") },
      { find: "next/link", replacement: resolve("./mobile/src/next-link.tsx") },
      { find: "next/image", replacement: resolve("./mobile/src/next-image.tsx") },
      { find: "@", replacement: root },
    ],
  },
  worker: { format: "es" },
  build: {
    outDir: resolve("./mobile-dist"),
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
