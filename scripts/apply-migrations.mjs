/**
 * Applies SQL migrations to Supabase.
 * Requires SUPABASE_DB_URL in .env.local (from Supabase → Settings → Database → Connection string).
 *
 * Usage: npm run db:migrate
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
    // .env.local optional if SUPABASE_DB_URL is already set
  }
}

async function main() {
  loadEnvLocal();

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error(
      "Missing SUPABASE_DB_URL. Add it to .env.local from Supabase → Settings → Database → URI.",
    );
    console.error(
      "Or paste supabase/migrations/001_initial_schema.sql into the Supabase SQL editor.",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const migrations = [
    "001_initial_schema.sql",
    "002_pg_trgm_index.sql",
    "003_reminder_lifecycle.sql",
    "004_auth_rls.sql",
    "005_google_oauth_tokens.sql",
    "006_google_services.sql",
    "007_youtube_taste_cache.sql",
    "008_push_subscriptions.sql",
    "009_thread_sections.sql",
    "010_message_fk_on_delete_set_null.sql",
  ];

  for (const file of migrations) {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", file), "utf8");
    console.log(`Applying ${file}...`);
    try {
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("already exists")) {
        console.log(`  · ${file} (already applied, skipping)`);
      } else {
        throw err;
      }
    }
  }

  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
