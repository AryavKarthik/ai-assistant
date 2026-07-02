import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const sharedAlias = { "@shared": new URL("./shared", import.meta.url).pathname };

export default defineConfig({
  main: {
    // Externalize ALL production dependencies from the main bundle — they are
    // resolved from node_modules at runtime (electron-builder ships production
    // deps automatically). Without this, `googleapis` (~3,400 modules) gets
    // statically bundled and rollup OOMs node's default 2 GB heap on build/dev.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      // Two entries: main process + wake-word worker thread (needs its own file)
      lib: {
        entry: {
          main: "electron/main.ts",
          worker: "electron/wakeword/worker.ts",
        },
      },
      rollupOptions: {
        // onnxruntime-node loads native .node bindings via dynamic require at
        // runtime — Rollup cannot statically bundle them. Mark as external so
        // Node resolves them from node_modules at runtime instead.
        external: ["onnxruntime-node", "ws"],
      },
    },
    resolve: { alias: sharedAlias },
  },
  preload: {
    build: {
      outDir: "out/preload",
      lib: { entry: "electron/preload.ts" },
      rollupOptions: {
        output: {
          // Electron sandbox requires CJS for preload scripts.
          // "type":"module" in package.json would otherwise emit .mjs.
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
    resolve: { alias: sharedAlias },
  },
  renderer: {
    plugins: [react()],
    root: ".",
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: new URL("./index.html", import.meta.url).pathname },
    },
    resolve: { alias: sharedAlias },
  },
});
