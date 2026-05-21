const { publicConfig, rpc, sendJson } = require("../lib/vercel-api");
const { tokenBalanceForOwner } = require("../lib/token-utils");

async function feeReceipts() {
  const config = publicConfig();
  if (!config.feeWallet) {
    return {
      configured: false,
      reason: "PUBLIC_FEE_WALLET is not configured",
      receipts: []
    };
  }

  const [signatures, lamports, wsol] = await Promise.all([
    rpc("getSignaturesForAddress", [
      config.feeWallet,
      { limit: Number(process.env.FEE_RECEIPT_LIMIT || 10) }
    ]),
    rpc("getBalance", [config.feeWallet]),
    tokenBalanceForOwner({ rpc, owner: config.feeWallet, mint: config.wsolMint })
  ]);

  return {
    configured: true,
    solBalance: lamports.value / 1_000_000_000,
    wsolBalance: wsol.balance,
    totalSolAndWsolBalance: lamports.value / 1_000_000_000 + wsol.balance,
    wsolAccountCount: wsol.accountCount,
    receipts: signatures.map((item) => ({
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime,
      status: item.err ? "failed" : "confirmed"
    }))
  };
}

module.exports = async function handler(_request, response) {
  try {
    sendJson(response, 200, await feeReceipts());
  } catch (error) {
    sendJson(response, 502, {
      configured: Boolean(process.env.SOLANA_RPC_URL),
      error: error.message,
      receipts: []
    });
  }
};
