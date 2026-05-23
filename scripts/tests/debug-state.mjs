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
const { holdersPayload, statusPayload } = require("../../lib/rewards/snapshotCache.js");
const { rewardConfig } = require("../../lib/rewards/config.js");

async function main() {
  console.log("DB configured:", store.databaseConfigured());
  console.log("Current env TOKEN_MINT:", process.env.TOKEN_MINT?.slice(0, 8));
  console.log("Reward config tokenMint:", rewardConfig().tokenMint?.slice(0, 8));
  console.log();

  const epochs = await store.listEpochs();
  console.log("Epoch count:", epochs.length);
  for (const e of epochs) {
    console.log("  epoch", e.epochIndex, "status=", e.status, "token_mint=", e.tokenMint?.slice(0, 8), "snapshot_completed_at=", e.snapshotCompletedAt);
    const holders = await store.holdersForEpoch(e.id);
    console.log("    holders:", holders.length);
    const batches = await store.batchesForEpoch(e.id);
    console.log("    batches:", batches.length);
  }

  const latestSnapshotted = await store.latestSnapshottedEpoch();
  console.log("\nLatest snapshotted:", latestSnapshotted ? { index: latestSnapshotted.epochIndex, status: latestSnapshotted.status, tokenMint: latestSnapshotted.tokenMint?.slice(0, 8) } : "none");

  const current = await store.currentEpoch();
  console.log("\nCurrent epoch:", current ? { index: current.epochIndex, status: current.status, endsAt: current.endsAt } : "none");

  const holders = await holdersPayload();
  console.log("\nholdersPayload:", JSON.stringify({ ok: holders.ok, degraded: holders.degraded, reason: holders.reason, rows: holders.rows.length, warning: holders.warning }, null, 2));

  const status = await statusPayload();
  console.log("\nstatusPayload:", JSON.stringify({ ok: status.ok, nextEpochCountdownSeconds: status.nextEpochCountdownSeconds, currentEpoch: status.current_epoch }, null, 2));
}

main().catch(console.error);
