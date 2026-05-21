const { requestUrl, rpc, sendJson } = require("../lib/vercel-api");
const { tokenBalanceForOwner } = require("../lib/token-utils");

async function tokenBalance(owner, mint) {
  return await tokenBalanceForOwner({ rpc, owner, mint });
}

module.exports = async function handler(request, response) {
  const url = requestUrl(request);

  try {
    sendJson(response, 200, await tokenBalance(url.searchParams.get("owner"), url.searchParams.get("mint")));
  } catch (error) {
    sendJson(response, 502, {
      configured: Boolean(process.env.SOLANA_RPC_URL),
      error: error.message,
      balance: null
    });
  }
};
