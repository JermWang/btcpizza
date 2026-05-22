const DEFAULT_WBTC_MINT = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
const DEFAULT_WSOL_MINT = "So11111111111111111111111111111111111111112";

function publicConfig() {
  const devCreatorWallet = process.env.DEV_CREATOR_WALLET || "";
  return {
    cluster: process.env.SOLANA_CLUSTER || "mainnet-beta",
    rpcConfigured: Boolean(process.env.SOLANA_RPC_URL),
    devCreatorWallet,
    feeWallet: process.env.PUBLIC_FEE_WALLET || devCreatorWallet,
    contractAddress: process.env.PUBLIC_CONTRACT_ADDRESS || process.env.PUBLIC_TOKEN_MINT || "",
    tokenMint: process.env.PUBLIC_TOKEN_MINT || "",
    wbtcMint: process.env.PUBLIC_WBTC_MINT || DEFAULT_WBTC_MINT,
    wsolMint: process.env.PUBLIC_WSOL_MINT || DEFAULT_WSOL_MINT,
    distributorWallet: process.env.PUBLIC_DISTRIBUTOR_WALLET || devCreatorWallet,
    jupiterConfigured: Boolean(process.env.JUPITER_API_BASE_URL || process.env.JUPITER_API_KEY || true),
    jupiterApiBaseUrl: process.env.JUPITER_API_BASE_URL || "https://api.jup.ag/swap/v1",
    jupiterSwapUserPublicKey: process.env.JUPITER_SWAP_USER_PUBLIC_KEY || devCreatorWallet,
    creatorFeeClaimPublicKey: process.env.CREATOR_PUBLIC_KEY || devCreatorWallet,
    pumpPortalLocalApiUrl: process.env.PUMPPORTAL_LOCAL_API_URL || "https://pumpportal.fun/api/trade-local",
    holderIndexerUrlConfigured: Boolean(process.env.HOLDER_INDEXER_API_URL),
    distributionIntervalSeconds: Number(process.env.PUBLIC_DISTRIBUTION_INTERVAL_SECONDS || process.env.DISTRIBUTION_INTERVAL_SECONDS || 600),
    distributionIntervalLabel: process.env.PUBLIC_DISTRIBUTION_INTERVAL_LABEL || "10 minutes",
    solscanBaseUrl: process.env.PUBLIC_SOLSCAN_BASE_URL || "https://solscan.io",
    coingeckoApiUrl: process.env.PUBLIC_COINGECKO_API_URL || "https://api.coingecko.com/api/v3"
  };
}

async function rpc(method, params) {
  if (!process.env.SOLANA_RPC_URL) {
    throw new Error("SOLANA_RPC_URL is not configured");
  }

  const result = await fetch(process.env.SOLANA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "btc-pizza-day",
      method,
      params
    })
  });

  if (!result.ok) {
    throw new Error(`RPC request failed: ${result.status}`);
  }

  const body = await result.json();
  if (body.error) {
    throw new Error(body.error.message || "RPC returned an error");
  }
  return body.result;
}

function sendJson(response, status, body) {
  response.setHeader("cache-control", "no-store");
  response.status(status).json(body);
}

function requestUrl(request) {
  const host = request.headers.host || "localhost";
  return new URL(request.url || "/", `https://${host}`);
}

module.exports = {
  publicConfig,
  requestUrl,
  rpc,
  sendJson
};
