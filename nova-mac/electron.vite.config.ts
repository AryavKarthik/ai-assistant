import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

const sharedAlias = { "@shared": new URL("./shared", import.meta.url).pathname };

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      // Two entries: main process + wake-word worker thread (needs its own file)
      lib: {
        entry: {
          main: "electron/main.ts",
          worker: "electron/wakeword/worker.ts",
        },
      },
    },
    resolve: { alias: sharedAlias },
  },
  preload: {
    build: { outDir: "out/preload", lib: { entry: "electron/preload.ts" } },
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
