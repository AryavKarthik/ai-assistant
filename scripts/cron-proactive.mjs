/**
 * Local dev helper: triggers proactive assistant cron.
 * Requires CRON_SECRET in .env.local.
 *
 * Usage: npm run cron:proactive
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  try {
    const envPath = join(__dirname, "..", ".env.local");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq);
      const value = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

async function main() {
  loadEnvLocal();

  const cronSecret = process.env.CRON_SECRET;
  const port = process.env.PORT ?? "3000";

  if (!cronSecret) {
    console.error("Missing CRON_SECRET in .env.local");
    process.exit(1);
  }

  const res = await fetch(`http://localhost:${port}/api/cron/proactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const data = await res.json();
  console.log(res.status, data);

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
