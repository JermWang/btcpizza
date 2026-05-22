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
  const epoch1 = await store.query("select * from reward_epochs where epoch_index = 1", []);
  console.log("Epoch 1:", JSON.stringify(epoch1.rows[0], null, 2));

  const holders = await store.holdersForEpoch(epoch1.rows[0].id);
  console.log("\nHolder rows:", holders.length);
  for (const h of holders) {
    console.log(`  rank=${h.rank} wallet=${h.owner_wallet} balance=${h.balance_ui} reward=${h.reward_ui} in_cap=${h.in_holder_cap}`);
  }

  const batches = await store.batchesForEpoch(epoch1.rows[0].id);
  console.log("\nBatches:", batches.length);
  for (const b of batches) {
    console.log(`  batch ${b.batch_index}: status=${b.status} transfers=${b.transfer_count} total=${b.total_reward_raw}`);
  }
}

main().catch(console.error);
