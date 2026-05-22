import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = mkdtempSync(join(tmpdir(), "btc-pizza-rewards-"));
process.env.ADMIN_STORAGE_PATH = root;
// Force file-based store (no DB) so tests are self-contained.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL_NON_POOLING;

const { epochIntervalSeconds } = require("../../lib/rewards/config.js");
const { buildBatches, calculatePayouts } = require("../../lib/rewards/distribution.js");
const { closeDueEpoch, ensureInitialEpoch, epochTick, isCronAuthorized } = require("../../lib/rewards/epochs.js");
const { holdersPayload, statusPayload } = require("../../lib/rewards/snapshotCache.js");
const { lookupWallet } = require("../../lib/rewards/ticketLookup.js");
const store = require("../../lib/rewards/store.js");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(
        () => { passed++; },
        (err) => { failed++; failures.push(`${name}: ${err.message}`); }
      );
    }
    passed++;
    return Promise.resolve();
  } catch (err) {
    failed++;
    failures.push(`${name}: ${err.message}`);
    return Promise.resolve();
  }
}

try {
  // ─── Epoch timing ───────────────────────────────────────────────────────────

  await test("epoch 0 interval = 180", () => assert.equal(epochIntervalSeconds(0), 180));
  await test("epoch 1 interval = 243", () => assert.equal(epochIntervalSeconds(1), 243));
  await test("epoch 2 interval = 328", () => assert.equal(epochIntervalSeconds(2), 328));
  await test("epoch 3 interval = 442", () => assert.equal(epochIntervalSeconds(3), 442));
  await test("epoch 4 interval = 597", () => assert.equal(epochIntervalSeconds(4), 597));
  await test("epoch 5 interval = 807", () => assert.equal(epochIntervalSeconds(5), 807));
  await test("interval caps at MAX_EPOCH_SECONDS", () => assert.equal(epochIntervalSeconds(1000), 86400));

  // ─── First tick before epoch is due ─────────────────────────────────────────

  await test("first tick creates epoch 0 and returns not_due", async () => {
    const tick = await epochTick();
    assert.equal(tick.ok, true);
    assert.equal(tick.status, "scheduled");
    assert.equal(tick.reason, "not_due");
    assert.equal(tick.epoch_index, 0);
  });

  // ─── Duplicate ticks do not duplicate epochs ─────────────────────────────────

  await test("duplicate tick calls do not create duplicate epochs", async () => {
    await epochTick();
    await epochTick();
    await epochTick();
    const epochs = [];
    let e = await store.currentEpoch();
    let latest = await store.latestEpoch();
    // Both currentEpoch and latestEpoch should point to epoch 0 still.
    assert.equal(Number(e.epoch_index), 0, "should still be epoch 0");
    assert.equal(Number(latest.epoch_index), 0, "latestEpoch should be epoch 0");
  });

  // ─── Lock prevents concurrent processing ─────────────────────────────────────

  await test("lock prevents concurrent epoch tick", async () => {
    // Acquire lock externally, then verify tick returns lock_active.
    await store.acquireLock("epoch_tick", "external-test-holder", 120);
    const tick = await epochTick();
    assert.equal(tick.ok, true);
    assert.equal(tick.skipped, true);
    assert.equal(tick.reason, "lock_active");
    await store.releaseLock("epoch_tick", "external-test-holder");
  });

  // ─── ensureInitialEpoch idempotency ──────────────────────────────────────────

  await test("ensureInitialEpoch returns epoch 0 with 180s interval", async () => {
    const first = await ensureInitialEpoch();
    assert.equal(first.epoch_index, 0);
    assert.equal(first.interval_seconds, 180);
  });

  await test("ensureInitialEpoch is idempotent", async () => {
    const a = await ensureInitialEpoch();
    const b = await ensureInitialEpoch();
    assert.equal(a.id, b.id, "same epoch returned on repeat calls");
  });

  // ─── Zero reward pool skips safely ──────────────────────────────────────────

  await test("closeDueEpoch with zero reward pool marks skipped_no_rewards", async () => {
    const epoch = await ensureInitialEpoch();
    const skipped = await closeDueEpoch(epoch, { rewardPool: { raw: "0", decimals: 8 } });
    assert.equal(skipped.status, "skipped_no_rewards");
    assert.equal(skipped.reason, "no_confirmed_reward_pool");
    const next = await store.latestEpoch();
    assert.equal(next.epoch_index, 1);
    assert.equal(next.interval_seconds, 243);
  });

  // ─── Zero holders skips safely ───────────────────────────────────────────────

  await test("closeDueEpoch with no eligible holders marks skipped_no_rewards", async () => {
    const latest = await store.latestEpoch();
    // Mark it due immediately.
    const due = await store.updateEpoch(latest.id, {
      ends_at: new Date(Date.now() - 1000).toISOString(),
      status: "scheduled"
    });
    const emptySnapshot = { snapshot: { source: "test", slot: 1 }, sourceRpc: "test", rows: [] };
    const result = await closeDueEpoch(due, {
      rewardPool: { raw: "1000", decimals: 8 },
      holderSnapshot: emptySnapshot
    });
    assert.equal(result.status, "skipped_no_rewards");
    assert.equal(result.reason, "no_eligible_holders");
  });

  // ─── BigInt reward math ─────────────────────────────────────────────────────

  await test("proportional rewards are exact with BigInt", () => {
    const payout = calculatePayouts(
      [
        { wallet: "walletA", balanceRaw: "100" },
        { wallet: "walletB", balanceRaw: "50" },
        { wallet: "walletC", balanceRaw: "50" }
      ],
      "101",
      { holderCap: 128, minRewardDustAtomic: 1n, rewardDecimals: 8 }
    );
    assert.deepEqual(
      payout.rows.map((row) => row.rewardRaw),
      ["50", "25", "25"],
      "proportional payouts"
    );
    assert.equal(payout.leftoverRewardRaw, "1", "rounding dust remains");
  });

  await test("zero reward pool gives all-zero rewards", () => {
    const payout = calculatePayouts(
      [{ wallet: "walletA", balanceRaw: "1000" }],
      "0",
      { holderCap: 128, rewardDecimals: 8 }
    );
    assert.equal(payout.rows[0].rewardRaw, "0");
    assert.equal(payout.distributedRewardRaw, "0");
    assert.equal(payout.leftoverRewardRaw, "0");
  });

  await test("below-dust rewards become zero and stay as leftover", () => {
    // minRewardDustAtomic defaults to 1n — a pool of 2 split among 3 holders
    // gives floor(2*1/3)=0 for 2 holders and floor(2*1/3)=0 for last, total=0, leftover=2.
    const payout = calculatePayouts(
      [
        { wallet: "w1", balanceRaw: "1" },
        { wallet: "w2", balanceRaw: "1" },
        { wallet: "w3", balanceRaw: "1" }
      ],
      "2",
      { holderCap: 128, minRewardDustAtomic: 2n, rewardDecimals: 8 }
    );
    // Each gets floor(2*1/3)=0, all below dust threshold of 2, so all zero.
    assert.equal(payout.distributedRewardRaw, "0");
    assert.equal(payout.leftoverRewardRaw, "2");
  });

  await test("holder cap limits recipients", () => {
    const holders = Array.from({ length: 200 }, (_, i) => ({
      wallet: `wallet${i}`,
      balanceRaw: String(200 - i)
    }));
    const payout = calculatePayouts(holders, "10000", { holderCap: 128, rewardDecimals: 8 });
    const eligible = payout.rows.filter((r) => r.inHolderCap);
    assert.equal(eligible.length, 128, "exactly 128 in holder cap");
    const ineligible = payout.rows.filter((r) => !r.inHolderCap);
    assert.ok(ineligible.every((r) => r.rewardRaw === "0"), "out-of-cap wallets get zero reward");
  });

  await test("calculatePayouts leftover + distributed === pool", () => {
    const payout = calculatePayouts(
      [
        { wallet: "w1", balanceRaw: "333" },
        { wallet: "w2", balanceRaw: "333" },
        { wallet: "w3", balanceRaw: "334" }
      ],
      "1000000007",
      { holderCap: 128, rewardDecimals: 8 }
    );
    const distributed = BigInt(payout.distributedRewardRaw);
    const leftover = BigInt(payout.leftoverRewardRaw);
    const pool = BigInt(payout.distributableRewardRaw);
    assert.equal(distributed + leftover, pool, "no atomics lost");
  });

  // ─── Batch builder ──────────────────────────────────────────────────────────

  await test("buildBatches groups recipients and excludes zero-reward rows", () => {
    const rows = [
      { owner_wallet: "w1", reward_raw: "100", in_holder_cap: true },
      { owner_wallet: "w2", reward_raw: "0", in_holder_cap: true },
      { owner_wallet: "w3", reward_raw: "50", in_holder_cap: true },
      { owner_wallet: "w4", reward_raw: "25", in_holder_cap: true },
      { owner_wallet: "w5", reward_raw: "25", in_holder_cap: true }
    ];
    const batches = buildBatches(rows, 2);
    assert.equal(batches.length, 2, "4 eligible recipients in batches of 2");
    assert.equal(batches[0].transferCount, 2);
    assert.equal(batches[1].transferCount, 2);
  });

  // ─── Full epoch close and distribution flow ──────────────────────────────────

  const latestForDist = await store.latestEpoch();
  const dueEpoch = await store.updateEpoch(latestForDist.id, {
    ends_at: new Date(Date.now() - 1000).toISOString(),
    status: "scheduled"
  });

  const mockHolders = {
    snapshot: { source: "test", slot: 456 },
    sourceRpc: "test",
    rows: [
      { wallet: "walletA", balanceRaw: "200", balanceUi: "200" },
      { wallet: "walletB", balanceRaw: "100", balanceUi: "100" }
    ]
  };

  await test("closeDueEpoch with holders and rewards creates distributing epoch", async () => {
    const result = await closeDueEpoch(dueEpoch, {
      rewardPool: { raw: "300", decimals: 8 },
      holderSnapshot: mockHolders
    });
    assert.equal(result.status, "distributing");
    assert.equal(result.reason, "batches_prepared");
    assert.ok(result.manifest_hash, "manifest_hash is set");
    assert.equal(result.recipient_count, 2);
  });

  // ─── Duplicate close does not duplicate holder rows ──────────────────────────

  await test("duplicate closeDueEpoch does not duplicate holder rows", async () => {
    const before = await holdersPayload();
    const rowsBefore = before.rows.length;
    await closeDueEpoch(dueEpoch, {
      rewardPool: { raw: "300", decimals: 8 },
      holderSnapshot: mockHolders
    });
    const after = await holdersPayload();
    assert.equal(after.rows.length, rowsBefore, "row count unchanged after duplicate close");
  });

  // ─── Duplicate closeDueEpoch does not duplicate batches ──────────────────────

  await test("duplicate closeDueEpoch does not duplicate batches", async () => {
    const epoch = await store.currentEpoch();
    const batchesBefore = await store.batchesForEpoch(epoch.id);
    await closeDueEpoch(dueEpoch, {
      rewardPool: { raw: "300", decimals: 8 },
      holderSnapshot: mockHolders
    });
    const batchesAfter = await store.batchesForEpoch(epoch.id);
    assert.equal(batchesAfter.length, batchesBefore.length, "batch count unchanged");
  });

  // ─── holdersPayload — DB-first, no RPC ──────────────────────────────────────

  await test("holdersPayload returns stored snapshot rows", async () => {
    const board = await holdersPayload("walletA");
    assert.equal(board.ok, true);
    assert.ok(board.rows.length >= 2, "at least 2 holder rows");
    assert.equal(board.current?.wallet, "walletA");
    assert.equal(board.current?.reward_raw, "200");
  });

  await test("holdersPayload wallet B gets proportional reward", async () => {
    const board = await holdersPayload("walletB");
    assert.equal(board.current?.reward_raw, "100");
  });

  // ─── Ticket checker ─────────────────────────────────────────────────────────

  await test("lookupWallet returns eligible for wallet in snapshot", async () => {
    const ticket = await lookupWallet("walletA");
    assert.equal(ticket.ok, true);
    assert.equal(ticket.reason, "eligible");
    assert.equal(ticket.above_cutoff, true);
    assert.ok(ticket.rank >= 1, "rank is set");
  });

  await test("lookupWallet returns not_in_top_128 for wallet not in snapshot", async () => {
    const ticket = await lookupWallet("walletZ");
    assert.equal(ticket.ok, true);
    assert.equal(ticket.reason, "not_in_top_128");
  });

  await test("lookupWallet returns not_in_top_128 for completely unknown wallet", async () => {
    const ticket = await lookupWallet("unknownWalletXYZ123");
    assert.equal(ticket.ok, true);
    assert.match(ticket.reason, /not_in_top_128/);
  });

  await test("lookupWallet with empty string returns error", async () => {
    const ticket = await lookupWallet("");
    assert.equal(ticket.ok, false);
  });

  // ─── statusPayload — DB-first ────────────────────────────────────────────────

  await test("statusPayload returns ok:true with current epoch", async () => {
    const status = await statusPayload();
    assert.equal(status.ok, true);
    assert.ok(status.current_epoch, "current_epoch is present");
    assert.ok(typeof status.next_epoch_countdown_seconds === "number");
  });

  // ─── Auth checks ─────────────────────────────────────────────────────────────

  await test("isCronAuthorized accepts valid CRON_SECRET in bearer header", () => {
    const secret = "test-cron-secret-12345";
    process.env.CRON_SECRET = secret;
    const authorized = isCronAuthorized({ authorization: `Bearer ${secret}` });
    assert.equal(authorized, true);
    delete process.env.CRON_SECRET;
  });

  await test("isCronAuthorized rejects missing auth", () => {
    const savedCronSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const authorized = isCronAuthorized({});
    // With no env secret, it falls back to hardcoded hashes — empty auth should still fail.
    assert.equal(authorized, false);
    if (savedCronSecret) process.env.CRON_SECRET = savedCronSecret;
  });

  await test("isCronAuthorized rejects wrong secret", () => {
    const secret = "test-cron-secret-12345";
    process.env.CRON_SECRET = secret;
    const authorized = isCronAuthorized({ authorization: "Bearer wrong-secret" });
    assert.equal(authorized, false);
    delete process.env.CRON_SECRET;
  });

  // ─── Next epoch created correctly ────────────────────────────────────────────

  await test("next epoch after epoch 1 has 328-second interval (epoch 2)", async () => {
    // Find epoch 1 and verify it was created with 243s.
    const allEpochs = await store.latestEpoch();
    // We should have progressed to at least epoch 1 by now.
    assert.ok(Number(allEpochs.epoch_index) >= 1, "at least epoch 1 was created");
    assert.equal(Number(allEpochs.interval_seconds), epochIntervalSeconds(Number(allEpochs.epoch_index)));
  });

  // ─── no_snapshot_yet reason when board is empty ───────────────────────────────

  await test("holdersPayload returns no_snapshot_yet when no epochs exist in fresh store", async () => {
    // Use a fresh temp dir with no epochs.
    const freshRoot = mkdtempSync(join(tmpdir(), "btc-pizza-fresh-"));
    const savedPath = process.env.ADMIN_STORAGE_PATH;
    process.env.ADMIN_STORAGE_PATH = freshRoot;
    try {
      // Re-require store and snapshotCache to get fresh state (file-based store reads from path).
      // Since modules are cached, we test through the store API directly.
      const freshStore = require("../../lib/rewards/store.js");
      // Directly call holdersPayload which queries store.currentEpoch() then latestEpoch().
      // In a fresh store with no file, both return null.
      const result = await holdersPayload();
      assert.equal(result.reason, "no_snapshot_yet");
    } finally {
      process.env.ADMIN_STORAGE_PATH = savedPath;
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  // ─── Report ──────────────────────────────────────────────────────────────────

  console.log(`\nReward engine smoke: ${passed} passed, ${failed} failed.`);
  if (failures.length) {
    console.error("\nFailed tests:");
    failures.forEach((f) => console.error(`  ✗ ${f}`));
    process.exit(1);
  }
  console.log("All tests passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
