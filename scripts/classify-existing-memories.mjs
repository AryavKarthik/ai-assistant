// Classify existing memories that have no memory_type set yet.
// Run: npm run db:classify-memories
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");

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

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Map old category values to new memory_type + salience
const CATEGORY_MAP = {
  fact:       { memory_type: "fact",       salience: 0.85 },
  preference: { memory_type: "preference", salience: 0.70 },
  goal:       { memory_type: "goal",       salience: 0.70 },
  other:      { memory_type: "fact",       salience: 0.60 },
};

// Pattern-based classification (mirrors lib/memory/classify.ts logic)
function classifyByPattern(content) {
  const c = content.toLowerCase();

  if (/\b(?:yesterday|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|met with|attended|went to|had (?:a |an )?(?:meeting|interview|call|session|exam|test))\b/.test(c)) {
    return { memory_type: "episodic", salience: 0.65 };
  }
  if (/\bmy (?:professor|prof|teacher|friend|boss|manager|colleague|partner|boyfriend|girlfriend|husband|wife|brother|sister|mom|mum|dad|father|mother)\b/.test(c)) {
    return { memory_type: "relationship", salience: 0.85 };
  }
  if (/\b(?:every (?:morning|evening|day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|my (?:morning|evening|daily) routine|i always|i usually)\b/.test(c)) {
    return { memory_type: "routine", salience: 0.80 };
  }
  if (/\b(?:i (?:want to|aim to|plan to|intend to)|my goal is|i'?m (?:trying|working|aiming) to)\b/.test(c)) {
    return { memory_type: "goal", salience: 0.70 };
  }
  if (/\b(?:i (?:know|can|play|speak|code|speak|write|program)|i'?m (?:good|proficient|fluent) (?:at|in|with)|i'?ve been (?:learning|studying))\b/.test(c)) {
    return { memory_type: "skill", salience: 0.70 };
  }
  if (/\b(?:i (?:love|like|enjoy|prefer|hate|dislike)|my favou?rite)\b/.test(c)) {
    return { memory_type: "preference", salience: 0.70 };
  }
  return null;
}

async function fetchUnclassifiedMemories(offset, limit) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/memories?select=id,content,category&memory_type=is.null&limit=${limit}&offset=${offset}&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  return res.json();
}

async function updateMemoryType(memoryId, memory_type, salience) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/memories?id=eq.${memoryId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ memory_type, salience }),
  });
  if (!res.ok) throw new Error(`Update failed for ${memoryId}: ${res.status}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("Starting memory classification...");
  let offset = 0;
  let total = 0;
  const BATCH = 100;

  while (true) {
    const memories = await fetchUnclassifiedMemories(offset, BATCH);
    if (!memories.length) break;

    for (const memory of memories) {
      // Try pattern first
      let classification = classifyByPattern(memory.content);

      // Fall back to old category mapping
      if (!classification && memory.category) {
        classification = CATEGORY_MAP[memory.category] ?? { memory_type: "fact", salience: 0.6 };
      }

      // Default
      if (!classification) {
        classification = { memory_type: "fact", salience: 0.6 };
      }

      try {
        await updateMemoryType(memory.id, classification.memory_type, classification.salience);
        total++;
      } catch (err) {
        console.error(`Failed for ${memory.id}:`, err.message);
      }
    }

    console.log(`Classified ${total} memories...`);
    offset += BATCH;
    await sleep(200);
  }

  console.log(`Done. ${total} memories classified.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
