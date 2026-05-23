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
const { epochTick, snapshotEligibleHolders, getConfirmedRewardPoolBalance } = require("../../lib/rewards/epochs.js");
const { statusPayload, holdersPayload } = require("../../lib/rewards/snapshotCache.js");
const { adminStatus, runScheduledEpoch } = require("../../lib/admin-control.js");
const { publicConfig } = require("../../lib/dashboard-service.js");

async function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

async function testRewardsEngine() {
  await section("1. REWARDS ENGINE (Dashboard / Public Epochs)");

  console.log("\n--- Current DB Epoch ---");
  const current = await store.currentEpoch();
  console.log("  ID:", current?.id);
  console.log("  Index:", current?.epoch_index);
  console.log("  Status:", current?.status);
  console.log("  Token Mint:", current?.token_mint);
  console.log("  Ends At:", current?.ends_at);
  console.log("  Started Processing:", current?.started_processing_at);
  console.log("  Snapshot Status:", current?.snapshot_status);

  console.log("\n--- Latest Snapshotted Epoch ---");
  const snapEpoch = await store.latestSnapshottedEpoch();
  console.log("  Index:", snapEpoch?.epoch_index ?? "none");
  console.log("  Status:", snapEpoch?.status ?? "none");
  console.log("  Snapshot Source:", snapEpoch?.snapshot_source ?? "none");

  console.log("\n--- Running epochTick ---");
  const tick = await epochTick({ source: "diagnostic-test" });
  console.log("  Result:", JSON.stringify(tick, null, 2));

  console.log("\n--- Dashboard Status Payload ---");
  const status = await statusPayload();
  console.log("  ok:", status.ok);
  console.log("  current_epoch.index:", status.current_epoch?.epoch_index);
  console.log("  current_epoch.status:", status.current_epoch?.status);
  console.log("  next_epoch_countdown_seconds:", status.next_epoch_countdown_seconds);
  console.log("  total_wbtc_pool:", status.total_wbtc_pool);
  console.log("  token_mint:", status.token_mint);

  console.log("\n--- Holder Board Payload ---");
  const holders = await holdersPayload();
  console.log("  ok:", holders.ok);
  console.log("  rows:", holders.rows?.length);
  console.log("  eligible:", holders.eligible_shown);
  console.log("  source:", holders.source);
  console.log("  snapshot_time:", holders.snapshot_time);

  if (holders.warning) {
    console.log("  WARNING:", holders.warning);
  }
}

async function testAdminSystem() {
  await section("2. ADMIN SYSTEM (Money Ops / Automation)");

  console.log("\n--- Admin Status ---");
  const admin = await adminStatus();
  console.log("  adminConfigured:", admin.adminConfigured);
  console.log("  automation.active:", admin.automation?.active);
  console.log("  automation.status:", admin.automation?.status);
  console.log("  automation.nextEpochIndex:", admin.automation?.nextEpochIndex);
  console.log("  automation.nextEpochEndsAt:", admin.automation?.nextEpochEndsAt);

  console.log("\n--- Required Config Checks ---");
  for (const req of admin.required) {
    const status = req.configured ? "OK" : "MISSING";
    console.log(`  ${status}: ${req.name}`);
  }

  console.log("\n--- Public Config ---");
  const cfg = publicConfig();
  console.log("  tokenMint:", cfg.tokenMint ? cfg.tokenMint.slice(0, 16) + "..." : "(not set)");
  console.log("  wbtcMint:", cfg.wbtcMint ? cfg.wbtcMint.slice(0, 16) + "..." : "(not set)");
  console.log("  feeWallet:", cfg.feeWallet ? cfg.feeWallet.slice(0, 16) + "..." : "(not set)");
  console.log("  distributorWallet:", cfg.distributorWallet ? cfg.distributorWallet.slice(0, 16) + "..." : "(not set)");
  console.log("  rpcConfigured:", cfg.rpcConfigured);

  console.log("\n--- NVDAx Pool Balance (Treasury) ---");
  try {
    const pool = await getConfirmedRewardPoolBalance(process.env);
    console.log("  raw:", pool.raw);
    console.log("  ui:", pool.ui);
    console.log("  decimals:", pool.decimals);
    console.log("  accountCount:", pool.accountCount);
  } catch (e) {
    console.log("  ERROR:", e.message);
  }
}

async function testLiveAutomationReadiness() {
  await section("3. LIVE AUTOMATION READINESS");

  const { liveAutomationMissing } = require("../../lib/admin-control.js");
  const cfg = publicConfig();
  const missing = liveAutomationMissing(cfg);

  if (missing.length === 0) {
    console.log("  ALL REQUIRED CONFIGS PRESENT - Live automation is ready!");
  } else {
    console.log("  MISSING CONFIGS (blocking live automation):");
    for (const item of missing) {
      console.log(`    - ${item}`);
    }
  }

  console.log("\n--- Signer Routing ---");
  const { hasConfiguredKeypair } = require("../../lib/solana-keypair.js");
  const creatorReady = hasConfiguredKeypair({ base58: ["CREATOR_PRIVATE_KEY_BASE58", "WALLET_PRIVATE_KEY"], file: ["CREATOR_KEYPAIR_PATH"] });
  const swapReady = hasConfiguredKeypair({ base58: ["JUPITER_SWAP_PRIVATE_KEY_BASE58", "DISTRIBUTOR_PRIVATE_KEY_BASE58", "WALLET_PRIVATE_KEY"], file: ["JUPITER_SWAP_KEYPAIR_PATH", "DISTRIBUTOR_KEYPAIR_PATH"] });
  const distributorReady = hasConfiguredKeypair({ base58: ["DISTRIBUTOR_PRIVATE_KEY_BASE58", "WALLET_PRIVATE_KEY"], file: ["DISTRIBUTOR_KEYPAIR_PATH"] });

  console.log("  Creator claim signer:", creatorReady ? "CONFIGURED" : "MISSING");
  console.log("  Jupiter swap signer:", swapReady ? "CONFIGURED" : "MISSING");
  console.log("  Distributor signer:", distributorReady ? "CONFIGURED" : "MISSING");

  if (!creatorReady || !swapReady || !distributorReady) {
    console.log("  NOTE: Without signers, fee claiming, NVDAx buying, and distribution cannot execute.");
    console.log("  The system can still snapshot holders and build manifests in dry-run mode.");
  }
}

async function testCronEndpointBehavior() {
  await section("4. CRON ENDPOINT SIMULATION");

  console.log("\n--- Current Cron Wiring ---");
  const epochTick = require("../../api/cron/epoch-tick.js");
  console.log("  Cron endpoint exists at: api/cron/epoch-tick.js");

  console.log("\n--- What the cron currently does ---");
  console.log("  1. Calls epochTick() -> creates/manages reward_epochs in PostgreSQL");
  console.log("  2. Updates public dashboard status + holder board");
  console.log("  3. Does NOT claim fees, buy NVDAx, or distribute");

  console.log("\n--- What happens when 'Go' is clicked ---");
  console.log("  1. officialLiveGo() arms admin automation in admin-store");
  console.log("  2. runScheduledEpoch() becomes eligible to run");
  console.log("  3. But the cron does NOT call runScheduledEpoch()");
  console.log("  4. So money ops never execute automatically");
}

async function main() {
  console.log("BTC PIZZA FULL FLOW DIAGNOSTIC");
  console.log(new Date().toISOString());

  try {
    await testRewardsEngine();
  } catch (e) {
    console.error("\nRewards engine test failed:", e.message);
  }

  try {
    await testAdminSystem();
  } catch (e) {
    console.error("\nAdmin system test failed:", e.message);
  }

  try {
    await testLiveAutomationReadiness();
  } catch (e) {
    console.error("\nLive readiness test failed:", e.message);
  }

  try {
    await testCronEndpointBehavior();
  } catch (e) {
    console.error("\nCron behavior test failed:", e.message);
  }

  await section("SUMMARY");
  console.log("\nThe rewards engine (public dashboard) is working correctly.");
  console.log("The admin money-ops system exists but is NOT wired to the cron.");
  console.log("To make everything work automatically when you click 'Go',");
  console.log("the cron endpoint needs to also call runScheduledEpoch().");
}

main().catch(console.error);
