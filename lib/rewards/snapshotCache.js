const { rewardConfig, stageLabel } = require("./config");
const { formatUiAmount, toBigInt } = require("./distribution");
const store = require("./store");

function epochPublic(epoch) {
  if (!epoch) {
    return {
      id: "",
      epoch_index: 0,
      status: "scheduled",
      starts_at: "",
      ends_at: "",
      interval_seconds: 180,
      holder_cap: 5,
      stage: "Baking"
    };
  }
  return {
    id: epoch.id,
    epoch_index: Number(epoch.epoch_index),
    status: epoch.status,
    starts_at: epoch.starts_at,
    ends_at: epoch.ends_at,
    interval_seconds: Number(epoch.interval_seconds),
    holder_cap: Number(epoch.holder_cap),
    stage: stageLabel(epoch.status),
    manifest_hash: epoch.manifest_hash || "",
    snapshot_slot: epoch.snapshot_slot ?? null,
    snapshot_status: epoch.snapshot_status || "snapshot_pending",
    completed_at: epoch.completed_at || "",
    error: epoch.error || epoch.snapshot_error || ""
  };
}

function countdownSeconds(epoch) {
  const endMs = Date.parse(epoch?.ends_at || "");
  if (!Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - Date.now()) / 1000));
}

function holderPublic(row) {
  const balanceRaw = String(row.balance_raw || "0");
  const rewardRaw = String(row.reward_raw || "0");
  return {
    wallet: row.owner_wallet,
    address: row.owner_wallet,
    rank: Number(row.rank),
    balance_raw: balanceRaw,
    balance: row.balance_ui || "",
    balanceLabel: row.balance_ui || formatUiAmount(balanceRaw, 6),
    weight: row.weight || balanceRaw,
    reward_raw: rewardRaw,
    projected_reward: row.reward_ui || formatUiAmount(rewardRaw, 8),
    estimatedNvdax: Number(row.reward_ui || 0),
    in_holder_cap: Boolean(row.in_holder_cap),
    eligible: Boolean(row.eligible && row.in_holder_cap && toBigInt(rewardRaw) > 0n),
    ata_exists: Boolean(row.ata_exists),
    ata_address: row.ata_address || "",
    transfer_status: row.transfer_status || "pending",
    transfer_signature: row.transfer_signature || "",
    status: row.in_holder_cap ? "eligible" : "below_cut",
    score: Number(row.balance_ui || 0),
    cutoffScore: 0,
    oddsLabel: row.in_holder_cap ? "Made cut" : "Below cut"
  };
}

async function statusPayload() {
  const config = rewardConfig();
  const epoch = await store.currentEpoch();
  const latest = await store.latestEpoch();
  const active = epochPublic(epoch || latest);
  const cache = await store.readCache("rewards_status");

  return {
    ok: true,
    degraded: false,
    generated_at: new Date().toISOString(),
    current_epoch: active,
    next_epoch_countdown_seconds: countdownSeconds(epoch),
    interval_seconds: active.interval_seconds,
    next_distribution_at: active.ends_at,
    total_nvdax_pool_raw: epoch?.total_reward_pool_raw || "0",
    total_nvdax_pool: formatUiAmount(epoch?.total_reward_pool_raw || "0", 8),
    creator_fees_collected: "--",
    last_receipt: "",
    holder_cap: config.holderCap,
    current_stage: active.stage,
    token_mint: config.tokenMint,
    reward_mint: config.rewardMint,
    fee_wallet: config.feeWallet,
    treasury_wallet: config.treasuryWallet,
    cached_at: cache?.generatedAt || ""
  };
}

async function holdersPayload(wallet = "") {
  const config = rewardConfig();
  const currentEpochRecord = await store.currentEpoch();
  const activeEpoch = currentEpochRecord || (await store.latestEpoch());
  const snapshotEpoch = await store.latestSnapshottedEpoch();

  // Check if the snapshotted epoch matches current token mint
  const tokenMintMismatch = snapshotEpoch?.token_mint && snapshotEpoch.token_mint !== config.tokenMint;
  const useSnapshot = snapshotEpoch && !tokenMintMismatch;

  // When no valid snapshot exists yet, try to show live preview data from the
  // current active epoch (populated by refreshLiveHolderList on every cron tick).
  if (!useSnapshot && activeEpoch) {
    const liveRows = (await store.holdersForEpoch(activeEpoch.id)).map(holderPublic);
    if (liveRows.length > 0) {
      const holderCap = Number(activeEpoch.holder_cap) || 5;
      const cutoff = liveRows.find((r) => r.in_holder_cap && r.rank === holderCap) || liveRows.filter((r) => r.in_holder_cap).at(-1);
      const cutoffScore = Number(cutoff?.score || 0);
      const mapped = liveRows.map((row) => ({
        ...row,
        cutoffScore,
        cutoffDelta: Number(row.score || 0) - cutoffScore,
        cutoffProgress: cutoffScore > 0 ? Math.min(100, (Number(row.score || 0) / cutoffScore) * 100) : row.in_holder_cap ? 100 : 0
      }));
      const query = wallet.trim().toLowerCase();
      const currentWallet = query ? mapped.find((r) => r.wallet.toLowerCase() === query || r.wallet.toLowerCase().includes(query)) || null : null;
      return {
        ok: true,
        degraded: false,
        configured: true,
        livePreview: true,
        source: "live-preview",
        sourceLabel: "Live — updates every 5 min",
        epoch: epochPublic(activeEpoch),
        roundCap: holderCap,
        holder_cap: holderCap,
        cutoffScore,
        cutoff_score: String(cutoffScore),
        eligibleCount: mapped.filter((r) => r.in_holder_cap).length,
        eligible_shown: mapped.filter((r) => r.in_holder_cap).length,
        totalHolderCount: mapped.length,
        snapshot_time: activeEpoch.updated_at || "",
        updatedAt: activeEpoch.updated_at || "",
        snapshot_slot: null,
        current: currentWallet,
        rows: mapped,
        holders: mapped
      };
    }
  }

  if (!useSnapshot) {
    return {
      ok: true,
      degraded: false,
      reason: "no_snapshot_yet",
      message: "Holder list loads on the first cron tick — should appear within 5 minutes.",
      epoch: activeEpoch ? epochPublic(activeEpoch) : null,
      holder_cap: activeEpoch ? Number(activeEpoch.holder_cap) : 5,
      cutoff_score: "0",
      eligible_shown: 0,
      snapshot_time: "",
      rows: [],
      holders: []
    };
  }

  const rows = (await store.holdersForEpoch(snapshotEpoch.id)).map(holderPublic);
  const cutoff = rows.find((row) => row.in_holder_cap && row.rank === Number(snapshotEpoch.holder_cap)) || rows.filter((row) => row.in_holder_cap).at(-1);
  const cutoffScore = Number(cutoff?.score || 0);
  const mapped = rows.map((row) => ({
    ...row,
    cutoffScore,
    cutoffDelta: Number(row.score || 0) - cutoffScore,
    cutoffProgress: cutoffScore > 0 ? Math.min(100, (Number(row.score || 0) / cutoffScore) * 100) : row.in_holder_cap ? 100 : 0
  }));
  const query = wallet.trim().toLowerCase();
  const currentWallet = query ? mapped.find((row) => row.wallet.toLowerCase() === query || row.wallet.toLowerCase().includes(query)) || null : null;
  return {
    ok: true,
    degraded: false,
    configured: true,
    source: snapshotEpoch.snapshot_source || "db-snapshot",
    sourceLabel: snapshotEpoch.snapshot_status === "snapshot_completed" ? "Stored snapshot" : "Snapshot pending",
    epoch: epochPublic(activeEpoch || snapshotEpoch),
    roundCap: Number(snapshotEpoch.holder_cap),
    holder_cap: Number(snapshotEpoch.holder_cap),
    cutoffScore,
    cutoff_score: String(cutoffScore),
    eligibleCount: mapped.filter((row) => row.in_holder_cap).length,
    eligible_shown: mapped.filter((row) => row.in_holder_cap).length,
    totalHolderCount: mapped.length,
    snapshot_time: snapshotEpoch.snapshot_completed_at || snapshotEpoch.updated_at || "",
    updatedAt: snapshotEpoch.snapshot_completed_at || snapshotEpoch.updated_at || "",
    snapshot_slot: snapshotEpoch.snapshot_slot ?? null,
    current: currentWallet,
    rows: mapped,
    holders: mapped
  };
}

async function receiptsPayload() {
  const rows = await store.receipts(50);
  const epoch = await store.currentEpoch();
  return {
    ok: true,
    degraded: false,
    epoch: epoch ? epochPublic(epoch) : null,
    epoch_index: epoch?.epoch_index ?? null,
    manifest_hash: epoch?.manifest_hash || "",
    receipts: rows.map((row) => ({
      id: row.id,
      epoch_index: row.epoch_index ?? null,
      manifest_hash: row.manifest_hash || "",
      recipient_wallet: row.recipient_wallet,
      reward_mint: row.reward_mint,
      amount_raw: row.amount_raw,
      amount_ui: row.amount_ui,
      signature: row.signature || "",
      solscan_url: row.solscan_url || "",
      status: row.status,
      created_at: row.created_at
    }))
  };
}

async function regenerateDashboardCache() {
  const [status, holders, receipts] = await Promise.all([statusPayload(), holdersPayload(), receiptsPayload()]);
  await Promise.all([
    store.writeCache("rewards_status", status, status.current_epoch?.id || null),
    store.writeCache("rewards_holders_latest", holders, holders.epoch?.id || null),
    store.writeCache("rewards_receipts_latest", receipts, receipts.epoch?.id || null)
  ]);
  return { status, holders, receipts };
}

async function cachedOrBuild(cacheKey, builder) {
  const cached = await store.readCache(cacheKey);
  if (cached?.payload) return { ...cached.payload, cached: true, cached_at: cached.generatedAt || cached.generated_at || "" };
  const payload = await builder();
  await store.writeCache(cacheKey, payload, payload.current_epoch?.id || payload.epoch?.id || null);
  return payload;
}

module.exports = {
  cachedOrBuild,
  holdersPayload,
  receiptsPayload,
  regenerateDashboardCache,
  statusPayload
};
