import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist/mountains-lab",
    emptyOutDir: true,
    rollupOptions: { input: resolve("experiments/mountains/index.html") },
  },
  server: { host: true },
});
