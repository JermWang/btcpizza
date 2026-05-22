import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Load local .env
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
try {
  const text = await readFile(join(root, ".env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
} catch {
  // ignore
}

const store = require("../../lib/rewards/store.js");

async function main() {
  console.log("DB configured:", store.databaseConfigured());

  const current = await store.currentEpoch();
  console.log("\nCurrent epoch:", JSON.stringify(current, null, 2));

  const latest = await store.latestEpoch();
  console.log("\nLatest epoch:", JSON.stringify(latest, null, 2));

  const snapEpoch = await store.latestSnapshottedEpoch();
  console.log("\nLatest snapshotted:", JSON.stringify(snapEpoch, null, 2));

  // Direct query all epochs
  const all = await store.query("select epoch_index, status, snapshot_status, token_mint from reward_epochs order by epoch_index", []);
  console.log("\nAll epochs:", JSON.stringify(all.rows, null, 2));
}

main().catch(console.error);
