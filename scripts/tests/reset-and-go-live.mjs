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
const { epochTick } = require("../../lib/rewards/epochs.js");

async function main() {
  console.log("=== Reset and Go Live ===\n");

  const epochs = await store.listEpochs();
  console.log(`Found ${epochs.length} epoch(s) in DB.`);

  if (epochs.length === 0) {
    console.log("No epochs to delete. Creating initial epoch...");
    await epochTick({ source: "go-live-reset" });
    console.log("Done! Initial epoch created.");
    return;
  }

  console.log("\nArchiving all existing epochs...");
  for (const epoch of epochs) {
    try {
      await store.archiveEpoch(epoch.id);
      console.log(`  Archived epoch ${epoch.epochIndex}`);
    } catch (err) {
      console.log(`  Could not archive epoch ${epoch.epochIndex}: ${err.message}`);
    }
  }

  console.log("\nDeleting all archived epochs and data...");
  for (const epoch of epochs) {
    try {
      await store.deleteEpochAndData(epoch.id);
      console.log(`  Deleted epoch ${epoch.epochIndex} + holders/batches/receipts`);
    } catch (err) {
      console.log(`  Could not delete epoch ${epoch.epochIndex}: ${err.message}`);
    }
  }

  console.log("\nAll test data cleared. Creating fresh epoch 0...");
  const tick = await epochTick({ source: "go-live-reset" });
  console.log("Tick result:", JSON.stringify(tick, null, 2));

  const fresh = await store.currentEpoch();
  console.log("\nFresh epoch 0:", JSON.stringify({
    id: fresh.id,
    index: fresh.epochIndex,
    status: fresh.status,
    startsAt: fresh.startsAt,
    endsAt: fresh.endsAt,
    tokenMint: fresh.tokenMint?.slice(0, 8)
  }, null, 2));

  console.log("\n=== Ready for live ===");
  console.log("Make sure your deployed TOKEN_MINT matches:", fresh.tokenMint?.slice(0, 16) + "...");
}

main().catch(console.error);
