import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist/mountains-lab",
    emptyOutDir: true,
    rollupOptions: { input: { mountains: resolve("experiments/mountains/index.html"), plan: resolve("experiments/mountains/plan-preview.html") } },
  },
  server: { host: true },
});
