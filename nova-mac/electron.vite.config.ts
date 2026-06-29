import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: { build: { outDir: "out/main", lib: { entry: "electron/main.ts" } } },
  preload: { build: { outDir: "out/preload", lib: { entry: "electron/preload.ts" } } },
  renderer: {
    plugins: [react()],
    build: { outDir: "out/renderer" },
    resolve: { alias: { "@shared": new URL("./shared", import.meta.url).pathname } },
  },
});
