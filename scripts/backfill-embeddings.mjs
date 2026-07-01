// Backfill embeddings for all memories that don't have one yet.
// Run: npm run db:backfill-embeddings
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");

// Load .env.local
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  console.error("Could not load .env.local");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BATCH_SIZE = 50;
const PAUSE_MS = 600;

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENAI_API_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or OPENAI_API_KEY");
  process.exit(1);
}

async function fetchMemoriesWithoutEmbeddings(offset, limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/memories?select=id,content&embedding=is.null&limit=${limit}&offset=${offset}&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  return res.json();
}

async function embedBatch(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function updateEmbedding(memoryId, embedding) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?id=eq.${memoryId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ embedding }),
  });
  if (!res.ok) throw new Error(`Supabase update failed for ${memoryId}: ${res.status}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Starting embedding backfill...");
  let offset = 0;
  let total = 0;
  let failed = 0;

  while (true) {
    const memories = await fetchMemoriesWithoutEmbeddings(offset, BATCH_SIZE);
    if (!memories.length) break;

    const texts = memories.map((m) => m.content.toLowerCase().replace(/\s+/g, " ").trim());
    let embeddings;
    try {
      embeddings = await embedBatch(texts);
    } catch (err) {
      console.error(`Batch embed failed at offset ${offset}:`, err.message);
      failed += memories.length;
      offset += BATCH_SIZE;
      await sleep(2000);
      continue;
    }

    for (let i = 0; i < memories.length; i++) {
      try {
        await updateEmbedding(memories[i].id, embeddings[i]);
        total++;
      } catch (err) {
        console.error(`Update failed for ${memories[i].id}:`, err.message);
        failed++;
      }
    }

    console.log(`Backfilled ${total} memories (${failed} failed)...`);
    offset += BATCH_SIZE;
    await sleep(PAUSE_MS);
  }

  console.log(`Done. ${total} memories embedded, ${failed} failed.`);

  if (total > 0) {
    console.log("\nNext step — create the IVFFlat index in Supabase SQL editor:");
    console.log("  create index memories_embedding_idx on memories");
    console.log("    using ivfflat (embedding vector_cosine_ops) with (lists = 100);");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
