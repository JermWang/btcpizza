async function tokenBalanceForOwner({ rpc, owner, mint }) {
  if (!owner || !mint) {
    return {
      configured: false,
      owner: owner || "",
      mint: mint || "",
      accountCount: 0,
      balance: 0
    };
  }

  const accounts = await rpc("getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed" }
  ]);

  const balance = accounts.value.reduce((total, account) => {
    const amount = account.account.data.parsed.info.tokenAmount.uiAmount || 0;
    return total + amount;
  }, 0);

  return {
    configured: true,
    owner,
    mint,
    accountCount: accounts.value.length,
    balance
  };
}

module.exports = {
  tokenBalanceForOwner
};
