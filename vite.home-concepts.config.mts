import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./mobile/home-concepts", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/home-concepts", import.meta.url)),
    emptyOutDir: true,
  },
  server: { host: "127.0.0.1", port: 4180, strictPort: true },
});
