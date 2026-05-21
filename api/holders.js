const { requestUrl, sendJson } = require("../lib/vercel-api");
const { fetchRpcHolderSnapshot, parseWalletList, toDashboardSnapshot } = require("../lib/rpc-holders");
const { publicConfig, rpc } = require("../lib/vercel-api");

async function holderSnapshot(wallet) {
  const config = publicConfig();
  const provider = process.env.HOLDER_SNAPSHOT_PROVIDER || "external";
  const allowRpcFallback = process.env.ENABLE_RPC_HOLDER_FALLBACK === "true" || provider === "solana-rpc";

  if (provider !== "solana-rpc" && process.env.HOLDER_INDEXER_API_URL) {
    const url = new URL(process.env.HOLDER_INDEXER_API_URL);
    if (wallet) url.searchParams.set("wallet", wallet);

    const result = await fetch(url, { headers: { accept: "application/json" } });
    if (!result.ok) {
      if (!allowRpcFallback) throw new Error(`Holder indexer failed: ${result.status}`);
    } else {
      return await result.json();
    }
  }

  if (!allowRpcFallback) {
    return {
      configured: false,
      reason: "HOLDER_INDEXER_API_URL is not configured and RPC holder fallback is disabled",
      wallet: wallet || "",
      current: null,
      holders: []
    };
  }

  const excludedWallets = [
    ...parseWalletList(process.env.HOLDER_EXCLUDED_WALLETS || ""),
    config.feeWallet,
    config.distributorWallet
  ].filter(Boolean);
  const snapshot = await fetchRpcHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc,
    minBalanceUi: Number(process.env.HOLDER_SNAPSHOT_MIN_BALANCE || 0),
    excludedWallets
  });

  return toDashboardSnapshot(snapshot, wallet || "", Number(process.env.HOLDER_ROUND_CAP || 128));
}

module.exports = async function handler(request, response) {
  const url = requestUrl(request);

  try {
    sendJson(response, 200, await holderSnapshot(url.searchParams.get("wallet")));
  } catch (error) {
    sendJson(response, 502, {
      configured: Boolean(process.env.HOLDER_INDEXER_API_URL),
      error: error.message,
      holders: []
    });
  }
};
