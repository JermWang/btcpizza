const { publicConfig } = require("../dashboard-service");

const PROJECT_CONFIG = {
  BRAND_NAME: "Jensen Strategy",
  SHORT_NAME: "Jensen",
  PRIMARY_REWARD_SYMBOL: "NVDAx",
  PRIMARY_REWARD_NAME: "NVIDIA xStock",
  PRIMARY_REWARD_MINT: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  PRIMARY_REWARD_CHAIN: "Solana",
  PRIMARY_REWARD_EXPLORER_URL: "https://solscan.io/token/Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  INITIAL_EPOCH_SECONDS: 180,
  EPOCH_GROWTH_FACTOR: 1.35,
  MAX_EPOCH_SECONDS: 86400,
  EPOCH_LOCK_TTL_SECONDS: 120,
  STATUS_POLL_MS: 15_000,
  HOLDERS_POLL_MS: 45_000,
  RECEIPTS_POLL_MS: 30_000,
};

const INITIAL_EPOCH_SECONDS = 180;
const EPOCH_GROWTH_FACTOR = 1.35;
const MAX_EPOCH_SECONDS = 86400;

// Holder cap doubles every epoch: 5 → 10 → 20 → 40 → 80 …
const INITIAL_HOLDER_CAP = 5;
const HOLDER_CAP_GROWTH_FACTOR = 2;
const MAX_HOLDER_CAP = 1000;

// Keep HOLDER_CAP as an alias for the initial cap (used in rewardConfig for
// callers that don't yet pass an epoch index — the value they get is epoch-0).
const HOLDER_CAP = INITIAL_HOLDER_CAP;

const MIN_REWARD_DUST_ATOMIC = 1n;
// 8 recipients per on-chain transaction is safely under Solana's 1232-byte limit
// even when ATA-creation instructions are included for every recipient.
const MAX_TRANSFERS_PER_BATCH = 8;
const EPOCH_LOCK_TTL_SECONDS = 120;

function epochIntervalSeconds(epochIndex) {
  const index = Math.max(0, Math.floor(Number(epochIndex) || 0));
  const seconds = Math.floor(INITIAL_EPOCH_SECONDS * EPOCH_GROWTH_FACTOR ** index);
  return Math.min(MAX_EPOCH_SECONDS, Math.max(1, seconds));
}

/**
 * Returns the holder cap for a given epoch index.
 * Epoch 0 → 5, epoch 1 → 10, epoch 2 → 20, epoch 3 → 40 …
 * Mirrors the distribution-policy holderCapMultiplier=2 used by the admin path.
 */
function holderCapForEpoch(epochIndex) {
  const index = Math.max(0, Math.floor(Number(epochIndex) || 0));
  const cap = Math.floor(INITIAL_HOLDER_CAP * HOLDER_CAP_GROWTH_FACTOR ** index);
  return Math.min(MAX_HOLDER_CAP, Math.max(1, cap));
}

function rewardConfig(env = process.env) {
  const config = publicConfig(env);
  return {
    tokenMint: config.tokenMint || "",
    rewardMint: config.wbtcMint || "",
    feeWallet: config.feeWallet || "",
    treasuryWallet: config.distributorWallet || config.feeWallet || "",
    solscanBaseUrl: config.solscanBaseUrl || "https://solscan.io",
    holderCap: INITIAL_HOLDER_CAP,
    minRewardDustAtomic: MIN_REWARD_DUST_ATOMIC,
    maxTransfersPerBatch: MAX_TRANSFERS_PER_BATCH
  };
}

function stageLabel(status) {
  return (
    {
      scheduled: "Warming GPUs",
      snapshotting: "Cutting allocations",
      distributing: "Shipping NVDAx",
      completed: "Delivered",
      skipped_no_rewards: "Waiting for fees",
      failed: "Needs repair"
    }[status] || "Warming GPUs"
  );
}

module.exports = {
  PROJECT_CONFIG,
  EPOCH_GROWTH_FACTOR,
  EPOCH_LOCK_TTL_SECONDS,
  HOLDER_CAP,
  HOLDER_CAP_GROWTH_FACTOR,
  INITIAL_EPOCH_SECONDS,
  INITIAL_HOLDER_CAP,
  MAX_EPOCH_SECONDS,
  MAX_HOLDER_CAP,
  MAX_TRANSFERS_PER_BATCH,
  MIN_REWARD_DUST_ATOMIC,
  epochIntervalSeconds,
  holderCapForEpoch,
  rewardConfig,
  stageLabel
};
