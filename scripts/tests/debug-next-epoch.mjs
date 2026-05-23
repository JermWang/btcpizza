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
const { epochTick, ensureNextEpochAfter } = require("../../lib/rewards/epochs.js");
const { epochIntervalSeconds } = require("../../lib/rewards/config.js");

async function main() {
  const current = await store.currentEpoch();
  console.log("Current epoch:", JSON.stringify({
    id: current.id,
    index: current.epoch_index,
    status: current.status,
    started_processing_at: current.started_processing_at,
    snapshot_completed_at: current.snapshot_completed_at,
    updated_at: current.updated_at,
    ends_at: current.ends_at
  }, null, 2));

  const batches = await store.batchesForEpoch(current.id);
  console.log("\nBatches:", batches.length);
  for (const b of batches) {
    console.log(`  batch ${b.batch_index}: status=${b.status} signature=${b.signature || "none"}`);
  }

  const timeoutMs = Number(process.env.EPOCH_DISTRIBUTION_TIMEOUT_MS || 600_000);
  const startedAtMs = Date.parse(current.started_processing_at || current.snapshot_completed_at || current.updated_at || "");
  const stale = Number.isFinite(startedAtMs) && Date.now() - startedAtMs > timeoutMs;
  console.log("\nStale check:");
  console.log("  timeoutMs:", timeoutMs);
  console.log("  startedAtMs:", startedAtMs);
  console.log("  now - startedAt:", Date.now() - startedAtMs);
  console.log("  is stale:", stale);

  console.log("\n--- Running epochTick manually ---");
  const tick = await epochTick({ source: "debug-test" });
  console.log("Tick result:", JSON.stringify(tick, null, 2));

  const after = await store.currentEpoch();
  console.log("\nAfter tick current epoch:", JSON.stringify({
    id: after.id,
    index: after.epoch_index,
    status: after.status,
    ends_at: after.ends_at
  }, null, 2));

  const allEpochs = await store.listEpochs();
  console.log("\nAll epochs:", allEpochs.map(e => ({ index: e.epoch_index, status: e.status, ends_at: e.ends_at })));
}

main().catch(console.error);
