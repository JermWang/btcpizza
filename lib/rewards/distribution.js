const { MAX_TRANSFERS_PER_BATCH, MIN_REWARD_DUST_ATOMIC } = require("./config");

function toBigInt(value) {
  const text = String(value ?? "0");
  return /^\d+$/.test(text) ? BigInt(text) : 0n;
}

function formatUiAmount(raw, decimals = 8) {
  const amount = toBigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function calculatePayouts(holders, distributableRewardRaw, options = {}) {
  const holderCap = Math.max(1, Math.floor(Number(options.holderCap || 5)));
  const dust = toBigInt(options.minRewardDustAtomic ?? MIN_REWARD_DUST_ATOMIC);
  const ranked = holders
    .map((holder) => ({
      ...holder,
      balanceRawBigInt: toBigInt(holder.balanceRaw ?? holder.balance_raw),
      wallet: holder.wallet || holder.owner || holder.owner_wallet || "",
      tokenAccount: holder.tokenAccount || holder.token_account || ""
    }))
    .filter((holder) => holder.wallet && holder.balanceRawBigInt > 0n)
    .sort((a, b) => (a.balanceRawBigInt === b.balanceRawBigInt ? a.wallet.localeCompare(b.wallet) : a.balanceRawBigInt > b.balanceRawBigInt ? -1 : 1))
    .map((holder, index) => ({ ...holder, rank: index + 1, inHolderCap: index < holderCap }));

  const included = ranked.filter((holder) => holder.inHolderCap);
  const totalHolderBalanceRaw = included.reduce((sum, holder) => sum + holder.balanceRawBigInt, 0n);
  const rewardPool = toBigInt(distributableRewardRaw);
  let distributed = 0n;

  const rows = ranked.map((holder) => {
    let rewardRaw = 0n;
    if (holder.inHolderCap && totalHolderBalanceRaw > 0n && rewardPool > 0n) {
      rewardRaw = (rewardPool * holder.balanceRawBigInt) / totalHolderBalanceRaw;
      if (rewardRaw < dust) rewardRaw = 0n;
    }
    distributed += rewardRaw;
    return {
      wallet: holder.wallet,
      tokenAccount: holder.tokenAccount,
      balanceRaw: holder.balanceRawBigInt.toString(),
      balanceUi: holder.balanceUi ?? holder.balance_ui ?? null,
      rank: holder.rank,
      weight: totalHolderBalanceRaw > 0n && holder.inHolderCap ? holder.balanceRawBigInt.toString() : "0",
      rewardRaw: rewardRaw.toString(),
      rewardUi: formatUiAmount(rewardRaw, options.rewardDecimals ?? 8),
      eligible: true,
      inHolderCap: holder.inHolderCap
    };
  });

  return {
    rows,
    totalHolderBalanceRaw: totalHolderBalanceRaw.toString(),
    distributableRewardRaw: rewardPool.toString(),
    distributedRewardRaw: distributed.toString(),
    leftoverRewardRaw: (rewardPool - distributed).toString()
  };
}

function buildBatches(holderRows, maxTransfers = MAX_TRANSFERS_PER_BATCH) {
  const recipients = holderRows.filter((row) => row.in_holder_cap !== false && toBigInt(row.reward_raw ?? row.rewardRaw) > 0n);
  const size = Math.max(1, Math.floor(Number(maxTransfers) || MAX_TRANSFERS_PER_BATCH));
  const batches = [];
  for (let index = 0; index < recipients.length; index += size) {
    const batchRecipients = recipients.slice(index, index + size);
    batches.push({
      batchIndex: batches.length,
      transferCount: batchRecipients.length,
      totalRewardRaw: batchRecipients.reduce((sum, row) => sum + toBigInt(row.reward_raw ?? row.rewardRaw), 0n).toString(),
      recipients: batchRecipients
    });
  }
  return batches;
}

module.exports = {
  buildBatches,
  calculatePayouts,
  formatUiAmount,
  toBigInt
};
