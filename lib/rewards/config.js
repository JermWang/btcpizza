const { publicConfig } = require("../dashboard-service");

const INITIAL_EPOCH_SECONDS = 180;
const EPOCH_GROWTH_FACTOR = 1.35;
const MAX_EPOCH_SECONDS = 86400;
const HOLDER_CAP = 5;
const MIN_REWARD_DUST_ATOMIC = 1n;
const MAX_TRANSFERS_PER_BATCH = 4;
const EPOCH_LOCK_TTL_SECONDS = 120;

function epochIntervalSeconds(epochIndex) {
  const index = Math.max(0, Math.floor(Number(epochIndex) || 0));
  const seconds = Math.floor(INITIAL_EPOCH_SECONDS * EPOCH_GROWTH_FACTOR ** index);
  return Math.min(MAX_EPOCH_SECONDS, Math.max(1, seconds));
}

function rewardConfig(env = process.env) {
  const config = publicConfig(env);
  return {
    tokenMint: config.tokenMint || "",
    rewardMint: config.wbtcMint || "",
    feeWallet: config.feeWallet || "",
    treasuryWallet: config.distributorWallet || config.feeWallet || "",
    solscanBaseUrl: config.solscanBaseUrl || "https://solscan.io",
    holderCap: HOLDER_CAP,
    minRewardDustAtomic: MIN_REWARD_DUST_ATOMIC,
    maxTransfersPerBatch: MAX_TRANSFERS_PER_BATCH
  };
}

function stageLabel(status) {
  return (
    {
      scheduled: "Baking",
      snapshotting: "Cutting slices",
      distributing: "Delivering slices",
      completed: "Delivered",
      skipped_no_rewards: "Waiting for fees",
      failed: "Needs repair"
    }[status] || "Baking"
  );
}

module.exports = {
  EPOCH_GROWTH_FACTOR,
  EPOCH_LOCK_TTL_SECONDS,
  HOLDER_CAP,
  INITIAL_EPOCH_SECONDS,
  MAX_EPOCH_SECONDS,
  MAX_TRANSFERS_PER_BATCH,
  MIN_REWARD_DUST_ATOMIC,
  epochIntervalSeconds,
  rewardConfig,
  stageLabel
};
