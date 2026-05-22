const { holdersPayload } = require("./snapshotCache");

async function lookupWallet(wallet) {
  const query = String(wallet || "").trim();
  if (!query) {
    return { ok: false, error: "wallet is required" };
  }
  const board = await holdersPayload(query);
  if (!board.epoch) {
    return {
      ok: true,
      wallet: query,
      reason: "no_snapshot_yet",
      message: "First holder snapshot begins when the first reward epoch closes."
    };
  }
  const found = board.current;
  if (!found) {
    return {
      ok: true,
      wallet: query,
      epoch_index: board.epoch.epoch_index,
      reason: board.rows.length ? "not_in_holder_cap" : "no_snapshot_yet",
      message: board.rows.length
        ? "This wallet was not inside the holder cap for this epoch."
        : "First holder snapshot begins when the first reward epoch closes."
    };
  }
  return {
    ok: true,
    wallet: found.wallet,
    epoch_index: board.epoch.epoch_index,
    balance: found.balance,
    balance_raw: found.balance_raw,
    rank: found.rank,
    above_cutoff: Boolean(found.in_holder_cap),
    projected_reward: found.projected_reward,
    reward_raw: found.reward_raw,
    transfer_status: found.transfer_status,
    transfer_signature: found.transfer_signature,
    receipt: found.transfer_signature ? { signature: found.transfer_signature } : null,
    reason: found.in_holder_cap ? "eligible" : "not_in_holder_cap"
  };
}

module.exports = {
  lookupWallet
};
