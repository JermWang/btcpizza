const { isAdminAuthorized } = require("../admin-control");
const { cronSecretMatches } = require("../secret-auth");
const { PublicKey } = require("@solana/web3.js");
const { fetchHolderSnapshot, parseWalletList } = require("../rpc-holders");
const { publicConfig } = require("../dashboard-service");
const { solanaRpc, selectedRpcUrl } = require("../rpc/solanaClient");
const { associatedTokenAddress } = require("../token-utils");
const { EPOCH_LOCK_TTL_SECONDS, epochIntervalSeconds, rewardConfig } = require("./config");
const { buildBatches, calculatePayouts, toBigInt } = require("./distribution");
const { buildManifest, manifestHash } = require("./manifest");
const { regenerateDashboardCache } = require("./snapshotCache");
const store = require("./store");

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const value = headers[name] || headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function bearerToken(headers) {
  const authorization = headerValue(headers, "authorization");
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

function isCronAuthorized(headers) {
  return isAdminAuthorized(headers) || cronSecretMatches(bearerToken(headers)) || cronSecretMatches(headerValue(headers, "x-cron-secret"));
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

async function ensureNextEpochAfter(epoch) {
  const nextIndex = Number(epoch.epoch_index) + 1;
  const existing = await store.latestEpoch();
  if (existing && Number(existing.epoch_index) >= nextIndex) return existing;
  const cfg = rewardConfig();
  const startsAt = epoch.completed_at || new Date().toISOString();
  const interval = epochIntervalSeconds(nextIndex);
  return await store.createEpoch({
    epochIndex: nextIndex,
    status: "scheduled",
    startsAt,
    endsAt: addSeconds(new Date(startsAt), interval),
    intervalSeconds: interval,
    holderCap: cfg.holderCap,
    tokenMint: cfg.tokenMint,
    rewardMint: cfg.rewardMint,
    feeWallet: cfg.feeWallet,
    treasuryWallet: cfg.treasuryWallet
  });
}

async function ensureInitialEpoch() {
  const current = await store.currentEpoch();
  if (current) return current;
  const cfg = rewardConfig();
  const startsAt = new Date().toISOString();
  return await store.createEpoch({
    epochIndex: 0,
    status: "scheduled",
    startsAt,
    endsAt: addSeconds(new Date(startsAt), epochIntervalSeconds(0)),
    intervalSeconds: epochIntervalSeconds(0),
    holderCap: cfg.holderCap,
    tokenMint: cfg.tokenMint,
    rewardMint: cfg.rewardMint,
    feeWallet: cfg.feeWallet,
    treasuryWallet: cfg.treasuryWallet
  });
}

async function getConfirmedRewardPoolBalance(env = process.env) {
  const cfg = rewardConfig(env);
  if (!cfg.treasuryWallet || !cfg.rewardMint) return { raw: "0", ui: "0", decimals: 8, accountCount: 0 };
  const supply = await solanaRpc("getTokenSupply", [cfg.rewardMint], env, { timeoutMs: 8_000 });
  const decimals = Number(supply?.value?.decimals ?? 8);
  let raw = 0n;
  let accountCount = 0;
  try {
    const accounts = await solanaRpc("getTokenAccountsByOwner", [cfg.treasuryWallet, { mint: cfg.rewardMint }, { encoding: "jsonParsed" }], env, {
      timeoutMs: 8_000
    });
    for (const account of accounts?.value || []) {
      const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount || "0";
      raw += toBigInt(amount);
      accountCount += 1;
    }
  } catch {
    const ata = associatedTokenAddress(new PublicKey(cfg.treasuryWallet), new PublicKey(cfg.rewardMint));
    const account = await solanaRpc("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }], env, { timeoutMs: 8_000 });
    const amount = account?.value?.data?.parsed?.info?.tokenAmount?.amount || "0";
    raw = toBigInt(amount);
    accountCount = account?.value ? 1 : 0;
  }
  return { raw: raw.toString(), decimals, accountCount };
}

async function snapshotEligibleHolders(epoch, env = process.env) {
  const config = publicConfig(env);
  const excludedWallets = [...parseWalletList(env.HOLDER_EXCLUDED_WALLETS || ""), config.feeWallet, config.distributorWallet].filter(Boolean);
  const sourceRpc = await selectedRpcUrl(env);
  const snapshot = await fetchHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc: (method, params) => solanaRpc(method, params, env, { timeoutMs: 20_000 }),
    minBalanceUi: Number(env.HOLDER_SNAPSHOT_MIN_BALANCE || 0),
    excludedWallets
  });
  return {
    snapshot,
    sourceRpc,
    rows: (snapshot.holders || []).map((holder) => ({
      wallet: holder.owner || holder.wallet,
      tokenAccount: holder.tokenAccount || "",
      balanceRaw: holder.balanceRaw || "0",
      balanceUi: holder.balanceUi
    }))
  };
}

async function closeDueEpoch(epoch, options = {}) {
  let current = epoch;
  const now = new Date().toISOString();
  current = await store.updateEpoch(current.id, {
    status: "snapshotting",
    snapshot_status: "snapshot_running",
    snapshot_started_at: now,
    started_processing_at: current.started_processing_at || now,
    error: null
  });

  let pool;
  try {
    pool = options.rewardPool || (await getConfirmedRewardPoolBalance(process.env));
  } catch (error) {
    current = await store.updateEpoch(current.id, {
      status: "failed",
      snapshot_status: "snapshot_failed",
      snapshot_error: error.message,
      last_rpc_failure_at: new Date().toISOString(),
      rpc_failure_count: Number(current.rpc_failure_count || 0) + 1,
      error: error.message
    });
    await regenerateDashboardCache();
    return { status: "failed", reason: "reward_pool_rpc_failed", epoch: current, error: error.message };
  }

  const rewardRaw = toBigInt(pool.raw);
  if (rewardRaw <= rewardConfig().minRewardDustAtomic) {
    current = await store.updateEpoch(current.id, {
      status: "skipped_no_rewards",
      total_reward_pool_raw: pool.raw,
      distributable_reward_raw: "0",
      leftover_reward_raw: pool.raw,
      snapshot_status: "snapshot_completed",
      snapshot_completed_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    await ensureNextEpochAfter(current);
    await regenerateDashboardCache();
    return { status: "skipped_no_rewards", reason: "no_confirmed_reward_pool", epoch: current };
  }

  let snapshotResult;
  try {
    snapshotResult = options.holderSnapshot || (await snapshotEligibleHolders(current, process.env));
  } catch (error) {
    current = await store.updateEpoch(current.id, {
      status: "failed",
      snapshot_status: "snapshot_failed",
      snapshot_error: error.message,
      last_rpc_failure_at: new Date().toISOString(),
      rpc_failure_count: Number(current.rpc_failure_count || 0) + 1,
      error: error.message
    });
    await regenerateDashboardCache();
    return { status: "failed", reason: "holder_snapshot_failed", epoch: current, error: error.message };
  }

  if (!snapshotResult.rows.length) {
    current = await store.updateEpoch(current.id, {
      status: "skipped_no_rewards",
      total_reward_pool_raw: pool.raw,
      distributable_reward_raw: pool.raw,
      leftover_reward_raw: pool.raw,
      snapshot_status: "snapshot_completed",
      snapshot_completed_at: new Date().toISOString(),
      snapshot_source: snapshotResult.snapshot.source || "holder-snapshot",
      snapshot_slot: snapshotResult.snapshot.slot || null,
      completed_at: new Date().toISOString()
    });
    await ensureNextEpochAfter(current);
    await regenerateDashboardCache();
    return { status: "skipped_no_rewards", reason: "no_eligible_holders", epoch: current };
  }

  const payouts = calculatePayouts(snapshotResult.rows, pool.raw, {
    holderCap: Number(current.holder_cap),
    rewardDecimals: pool.decimals || 8
  });
  await store.upsertHolderRows(current.id, payouts.rows);
  const holderRows = await store.holdersForEpoch(current.id);
  const manifest = buildManifest(
    {
      ...current,
      total_holder_balance_raw: payouts.totalHolderBalanceRaw,
      distributable_reward_raw: payouts.distributableRewardRaw
    },
    holderRows
  );
  const hash = manifestHash(manifest);
  current = await store.updateEpoch(current.id, {
    status: "distributing",
    total_holder_balance_raw: payouts.totalHolderBalanceRaw,
    total_reward_pool_raw: pool.raw,
    distributable_reward_raw: payouts.distributableRewardRaw,
    distributed_reward_raw: payouts.distributedRewardRaw,
    leftover_reward_raw: payouts.leftoverRewardRaw,
    manifest_hash: hash,
    snapshot_status: "snapshot_completed",
    snapshot_completed_at: new Date().toISOString(),
    snapshot_source: snapshotResult.snapshot.source || "holder-snapshot",
    snapshot_slot: snapshotResult.snapshot.slot || null,
    last_rpc_success_at: new Date().toISOString()
  });
  await store.upsertBatches(current.id, buildBatches(holderRows, rewardConfig().maxTransfersPerBatch));
  await regenerateDashboardCache();
  return {
    status: "distributing",
    reason: "batches_prepared",
    epoch: current,
    manifest_hash: hash,
    recipient_count: manifest.recipients.length,
    remaining_batches: (await store.batchesForEpoch(current.id)).filter((batch) => batch.status !== "completed").length
  };
}

async function resumeDistributing(epoch) {
  const batches = await store.batchesForEpoch(epoch.id);
  const remaining = batches.filter((batch) => batch.status !== "completed").length;
  if (remaining === 0) {
    const completed = await store.updateEpoch(epoch.id, {
      status: "completed",
      completed_at: new Date().toISOString()
    });
    await regenerateDashboardCache();
    return {
      status: "completed",
      reason: "all_batches_done",
      epoch: completed,
      processed_batches: batches.length,
      remaining_batches: 0
    };
  }

  // Auto-abandon pending batches that have no signatures.
  // If the epoch's scheduled end time has already passed, complete immediately
  // so the next epoch timer can start right away (dry-run / test mode).
  const timeoutMs = Number(process.env.EPOCH_DISTRIBUTION_TIMEOUT_MS || 600_000);
  const startedAtMs = Date.parse(epoch.started_processing_at || epoch.snapshot_completed_at || epoch.updated_at || "");
  const endMs = Date.parse(epoch.ends_at || "");
  const allPendingUnsigned = remaining > 0 && batches.every((batch) => batch.status === "completed" || !batch.signature);
  const pastDue = Number.isFinite(endMs) && Date.now() > endMs;
  const stale = Number.isFinite(startedAtMs) && Date.now() - startedAtMs > timeoutMs;
  if (allPendingUnsigned && (pastDue || stale)) {
    for (const batch of batches) {
      if (batch.status !== "completed") {
        await store.updateBatch(batch.id, { status: "abandoned", completed_at: new Date().toISOString() });
      }
    }
    const completed = await store.updateEpoch(epoch.id, {
      status: "completed",
      completed_at: new Date().toISOString()
    });
    await regenerateDashboardCache();
    return {
      status: "completed",
      reason: "stale_batches_abandoned",
      epoch: completed,
      processed_batches: batches.length,
      remaining_batches: 0
    };
  }

  await regenerateDashboardCache();
  return {
    status: "distributing",
    reason: "transfer_batches_pending",
    epoch,
    processed_batches: batches.filter((batch) => batch.status === "completed").length,
    remaining_batches: remaining
  };
}

async function epochTick(options = {}) {
  const lockId = `cron-job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const locked = await store.acquireLock("epoch_tick", lockId, EPOCH_LOCK_TTL_SECONDS);
  if (!locked) {
    return { ok: true, skipped: true, reason: "lock_active", action: "epoch-tick" };
  }

  try {
    let epoch = await ensureInitialEpoch();
    const nowMs = Date.now();
    const endMs = Date.parse(epoch.ends_at);

    if (epoch.status === "scheduled" && Number.isFinite(endMs) && nowMs < endMs) {
      await regenerateDashboardCache();
      return {
        ok: true,
        action: "epoch-tick",
        epoch_index: Number(epoch.epoch_index),
        status: "scheduled",
        reason: "not_due",
        next_epoch_at: epoch.ends_at,
        processed_batches: 0,
        remaining_batches: 0
      };
    }

    let result;
    if (epoch.status === "scheduled") result = await closeDueEpoch(epoch, options);
    else if (epoch.status === "snapshotting" || epoch.status === "distributing") {
      result = await resumeDistributing(epoch);
      if (result.status === "completed") {
        epoch = await ensureNextEpochAfter(result.epoch);
        result = { status: epoch.status, reason: "next_epoch_ready", epoch };
      }
    } else {
      epoch = await ensureNextEpochAfter(epoch);
      result = { status: epoch.status, reason: "next_epoch_ready", epoch };
    }

    return {
      ok: true,
      action: "epoch-tick",
      epoch_index: Number(result.epoch?.epoch_index ?? epoch.epoch_index),
      status: result.status,
      reason: result.reason,
      next_epoch_at: result.epoch?.ends_at || epoch.ends_at,
      processed_batches: result.processed_batches || 0,
      remaining_batches: result.remaining_batches || 0,
      manifest_hash: result.manifest_hash || result.epoch?.manifest_hash || ""
    };
  } catch (error) {
    return { ok: false, action: "epoch-tick", status: "failed", error: error.message || "Epoch tick failed." };
  } finally {
    await store.releaseLock("epoch_tick", lockId);
  }
}

module.exports = {
  closeDueEpoch,
  ensureInitialEpoch,
  epochTick,
  getConfirmedRewardPoolBalance,
  isCronAuthorized,
  snapshotEligibleHolders
};
