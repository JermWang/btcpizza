const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function parseWalletList(value = "") {
  return String(value)
    .split(/[,\n\r\t ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseTokenAccount(account, index) {
  const info = account?.account?.data?.parsed?.info;
  const tokenAmount = info?.tokenAmount;
  const owner = typeof info?.owner === "string" ? info.owner : "";
  const balanceRaw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
  const balanceUi = firstNumber(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount);

  if (!owner || balanceRaw === "0" || balanceUi <= 0) return null;

  return {
    owner,
    wallet: owner,
    address: owner,
    balanceRaw,
    balanceUi,
    sourceRank: index + 1
  };
}

function mergeAndFilterHolders(holders, minBalanceUi, excludedWallets) {
  const excluded = new Set(excludedWallets.map((wallet) => wallet.toLowerCase()));
  const byOwner = new Map();

  for (const holder of holders) {
    const key = holder.owner.toLowerCase();
    if (excluded.has(key)) continue;
    if (holder.balanceUi < minBalanceUi) continue;

    const existing = byOwner.get(key);
    if (!existing) {
      byOwner.set(key, { ...holder });
      continue;
    }

    existing.balanceUi += holder.balanceUi;
    if (/^\d+$/.test(existing.balanceRaw) && /^\d+$/.test(holder.balanceRaw)) {
      existing.balanceRaw = (BigInt(existing.balanceRaw) + BigInt(holder.balanceRaw)).toString();
    }
  }

  return [...byOwner.values()]
    .sort((a, b) => b.balanceUi - a.balanceUi)
    .map((holder, index) => ({ ...holder, sourceRank: index + 1 }));
}

function applySupplyPercent(holders, supplyRaw) {
  if (!/^\d+$/.test(String(supplyRaw))) return holders;
  const supply = BigInt(supplyRaw);
  if (supply <= 0n) return holders;

  return holders.map((holder) => {
    if (!/^\d+$/.test(holder.balanceRaw)) return holder;
    return {
      ...holder,
      supplyPercent: Number((BigInt(holder.balanceRaw) * 1_000_000n) / supply) / 10_000
    };
  });
}

function formatBalance(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: value >= 1 ? 4 : 8
  });
}

function holderSearchText(holder) {
  return [holder?.wallet, holder?.address, holder?.owner, holder?.solDomain, holder?.domain, holder?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function toDashboardSnapshot(snapshot, walletQuery = "", roundCap = 128) {
  const cutoffHolder = snapshot.holders[Math.max(0, Math.min(roundCap, snapshot.holders.length) - 1)];
  const cutoffScore = cutoffHolder?.balanceUi ?? 0;
  const query = walletQuery.trim().toLowerCase();

  const holders = snapshot.holders.map((holder, index) => {
    const rank = index + 1;
    const eligible = rank <= roundCap;
    const score = holder.balanceUi;
    return {
      wallet: holder.owner,
      address: holder.owner,
      rank,
      score,
      cutoffScore,
      cutoffDelta: score - cutoffScore,
      cutoffProgress: cutoffScore > 0 ? Math.min(100, (score / cutoffScore) * 100) : eligible ? 100 : 0,
      estimatedWbtc: null,
      balanceLabel: formatBalance(holder.balanceUi),
      heldLabel: "Live RPC",
      oddsLabel: eligible ? "Made cut" : "Below cut",
      status: eligible ? "eligible" : "below_cut",
      eligible,
      supplyPercent: holder.supplyPercent
    };
  });

  const current = query
    ? holders.find((holder) => holderSearchText(holder) === query) ||
      holders.find((holder) => holderSearchText(holder).includes(query)) ||
      null
    : null;

  return {
    configured: true,
    source: snapshot.source,
    tokenMint: snapshot.tokenMint,
    roundCap,
    cutoffScore,
    eligibleCount: Math.min(roundCap, holders.length),
    updatedAt: snapshot.createdAt,
    current,
    holders
  };
}

async function fetchRpcHolderSnapshot(options) {
  const { tokenMint, rpc, minBalanceUi = 0, excludedWallets = [] } = options;
  if (!tokenMint || tokenMint.length < 32) {
    throw new Error("PUBLIC_TOKEN_MINT is required for direct RPC holder snapshots.");
  }

  const [accounts, supply] = await Promise.all([
    rpc("getProgramAccounts", [
      TOKEN_PROGRAM_ID,
      {
        encoding: "jsonParsed",
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: tokenMint } }
        ]
      }
    ]),
    rpc("getTokenSupply", [tokenMint])
  ]);

  const fetched = (Array.isArray(accounts) ? accounts : [])
    .map((account, index) => parseTokenAccount(account, index))
    .filter(Boolean);
  const holders = applySupplyPercent(mergeAndFilterHolders(fetched, minBalanceUi, excludedWallets), supply?.value?.amount);
  const totalBalanceUi = holders.reduce((sum, holder) => sum + holder.balanceUi, 0);

  return {
    version: 1,
    tokenMint,
    source: "solana-rpc",
    createdAt: new Date().toISOString(),
    minBalanceUi,
    excludedWallets,
    totalFetched: fetched.length,
    totalEligible: holders.length,
    totalBalanceUi,
    holders
  };
}

module.exports = {
  fetchRpcHolderSnapshot,
  parseWalletList,
  toDashboardSnapshot
};
