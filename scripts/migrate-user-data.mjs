/**
 * Reassigns all user-owned rows from one public.users id to another.
 * Run after first Supabase Auth login to keep existing v1 seed data.
 *
 * Usage:
 *   node scripts/migrate-user-data.mjs --from=a0000000-0000-4000-8000-000000000001 --to=<auth-uuid>
 *
 * Requires SUPABASE_DB_URL in .env.local (or env).
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

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

function parseArgs() {
  const args = process.argv.slice(2);
  let from;
  let to;
  for (const arg of args) {
    if (arg.startsWith("--from=")) from = arg.slice(7);
    if (arg.startsWith("--to=")) to = arg.slice(5);
  }
  if (!from || !to) {
    console.error(
      "Usage: node scripts/migrate-user-data.mjs --from=<old-uuid> --to=<new-auth-uuid>",
    );
    process.exit(1);
  }
  return { from, to };
}

const TABLES = [
  "conversations",
  "memories",
  "workouts",
  "reminders",
  "google_oauth_tokens",
] as const;

async function main() {
  loadEnvLocal();
  const { from, to } = parseArgs();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Missing SUPABASE_DB_URL in .env.local");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `insert into users (id) values ($1) on conflict (id) do nothing`,
      [to],
    );

    for (const table of TABLES) {
      const { rowCount } = await client.query(
        `update ${table} set user_id = $1 where user_id = $2`,
        [to, from],
      );
      console.log(`  ${table}: ${rowCount ?? 0} rows updated`);
    }

    await client.query("COMMIT");
    console.log(`Migration complete: ${from} → ${to}`);
    console.log(
      "You can remove DEFAULT_USER_ID from .env.local if no longer needed.",
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
