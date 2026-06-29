import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function probeNative(): string {
  // Loaded lazily so dev without a build still boots.
  const addon = require("bindings")("probe") as { probe(): string };
  return addon.probe();
}
