import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

const sharedAlias = { "@shared": new URL("./shared", import.meta.url).pathname };

export default defineConfig({
  main: {
    build: { outDir: "out/main", lib: { entry: "electron/main.ts" } },
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
