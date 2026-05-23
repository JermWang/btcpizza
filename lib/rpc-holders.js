const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const { PublicKey } = require("@solana/web3.js");
const { rpcOriginHeaders } = require("./solana-rpc");

let heliusDisabledUntilMs = 0;

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

function rawToUiAmount(rawAmount, decimals) {
  const raw = String(rawAmount ?? "0");
  if (!/^\d+$/.test(raw)) return 0;
  const scale = 10 ** Number(decimals || 0);
  if (!Number.isFinite(scale) || scale <= 0) return Number(raw);
  return Number(raw) / scale;
}

function abortSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
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

function parseHeliusTokenAccount(account, index, decimals) {
  const owner = typeof account?.owner === "string" ? account.owner : "";
  const rawAmount = account?.amount ?? account?.tokenAmount?.amount ?? "0";
  const balanceRaw = String(rawAmount ?? "0");
  const balanceUi = firstNumber(account?.uiAmount ?? account?.ui_amount ?? account?.tokenAmount?.uiAmountString) || rawToUiAmount(balanceRaw, decimals);

  if (!owner || balanceRaw === "0" || balanceUi <= 0) return null;

  return {
    owner,
    wallet: owner,
    address: owner,
    tokenAccount: account.address || "",
    balanceRaw,
    balanceUi,
    sourceRank: index + 1
  };
}

function parseBinaryTokenAccount(account, index, decimals) {
  const encoded = Array.isArray(account?.account?.data) ? account.account.data[0] : "";
  if (!encoded) return null;
  const data = Buffer.from(encoded, "base64");
  if (data.length < 165) return null;

  const mint = new PublicKey(data.subarray(0, 32)).toBase58();
  const owner = new PublicKey(data.subarray(32, 64)).toBase58();
  const amountRaw = data.readBigUInt64LE(64).toString();
  const state = data.readUInt8(108);
  const balanceUi = rawToUiAmount(amountRaw, decimals);

  if (!owner || amountRaw === "0" || balanceUi <= 0 || state === 0) return null;

  return {
    owner,
    wallet: owner,
    address: owner,
    tokenAccount: account.pubkey || "",
    mint,
    balanceRaw: amountRaw,
    balanceUi,
    sourceRank: index + 1
  };
}

function supplyPercentFromRaw(balanceRaw, supplyRaw) {
  if (!/^\d+$/.test(String(balanceRaw)) || !/^\d+$/.test(String(supplyRaw))) return null;
  const supply = BigInt(supplyRaw);
  if (supply <= 0n) return null;
  return Number((BigInt(balanceRaw) * 1_000_000n) / supply) / 10_000;
}

function exclusionConfig(options = {}) {
  return {
    wallets: new Set((options.excludedWallets || []).map((wallet) => wallet.toLowerCase())),
    poolWallets: new Set(parseWalletList(process.env.HOLDER_EXCLUDED_POOL_WALLETS || "").map((wallet) => wallet.toLowerCase())),
    maxSupplyPercent: Number(process.env.HOLDER_MAX_SUPPLY_PERCENT || 25)
  };
}

function classifyExclusion(holder, config, supplyRaw) {
  const key = holder.owner.toLowerCase();
  if (config.wallets.has(key)) return { excluded: true, reason: "configured_excluded_wallet" };
  if (config.poolWallets.has(key)) return { excluded: true, reason: "configured_pool_wallet" };

  const supplyPercent = supplyPercentFromRaw(holder.balanceRaw, supplyRaw);
  if (Number.isFinite(config.maxSupplyPercent) && config.maxSupplyPercent > 0 && supplyPercent !== null && supplyPercent >= config.maxSupplyPercent) {
    return { excluded: true, reason: "max_supply_percent" };
  }

  return { excluded: false, reason: "" };
}

function mergeHolders(holders, minBalanceUi) {
  const byOwner = new Map();

  for (const holder of holders) {
    if (holder.balanceUi < minBalanceUi) continue;

    const key = holder.owner.toLowerCase();
    const existing = byOwner.get(key);
    if (!existing) {
      byOwner.set(key, { ...holder });
      continue;
    }

    existing.balanceUi += holder.balanceUi;
    existing.tokenAccountCount = Number(existing.tokenAccountCount || 1) + 1;
    if (/^\d+$/.test(existing.balanceRaw) && /^\d+$/.test(holder.balanceRaw)) {
      existing.balanceRaw = (BigInt(existing.balanceRaw) + BigInt(holder.balanceRaw)).toString();
    }
  }

  return [...byOwner.values()];
}

function prepareHolderSets(holders, minBalanceUi, excludedWallets, supplyRaw) {
  const config = exclusionConfig({ excludedWallets });
  const merged = mergeHolders(holders, minBalanceUi).map((holder) => ({
    ...holder,
    supplyPercent: supplyPercentFromRaw(holder.balanceRaw, supplyRaw)
  }));
  const excluded = [];
  const eligible = [];

  for (const holder of merged) {
    const exclusion = classifyExclusion(holder, config, supplyRaw);
    if (exclusion.excluded) {
      excluded.push({
        ...holder,
        excluded: true,
        exclusionReason: exclusion.reason
      });
    } else {
      eligible.push(holder);
    }
  }

  const sortHolders = (rows) =>
    rows
      .sort((a, b) => b.balanceUi - a.balanceUi)
      .map((holder, index) => ({ ...holder, sourceRank: index + 1 }));

  return {
    holders: sortHolders(eligible),
    excludedHolders: sortHolders(excluded)
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

function snapshotFromFetched({ tokenMint, tokenProgramId, source, minBalanceUi, excludedWallets, fetched, supply }) {
  const { holders, excludedHolders } = prepareHolderSets(fetched, minBalanceUi, excludedWallets, supply?.value?.amount);
  const withPercent = applySupplyPercent(holders, supply?.value?.amount);
  const excludedWithPercent = applySupplyPercent(excludedHolders, supply?.value?.amount);
  const totalBalanceUi = withPercent.reduce((sum, holder) => sum + holder.balanceUi, 0);
  const excludedBalanceUi = excludedWithPercent.reduce((sum, holder) => sum + holder.balanceUi, 0);

  return {
    version: 1,
    tokenMint,
    tokenProgramId,
    source,
    createdAt: new Date().toISOString(),
    minBalanceUi,
    excludedWallets,
    holderMaxSupplyPercent: Number(process.env.HOLDER_MAX_SUPPLY_PERCENT || 25),
    totalFetched: fetched.length,
    totalEligible: withPercent.length,
    totalExcluded: excludedWithPercent.length,
    totalBalanceUi,
    excludedBalanceUi,
    holders: withPercent,
    excludedHolders: excludedWithPercent
  };
}

function emptyPrelaunchSnapshot({ tokenMint, tokenProgramId = TOKEN_PROGRAM_ID, source, minBalanceUi, excludedWallets }) {
  return {
    ...snapshotFromFetched({
      tokenMint,
      tokenProgramId,
      source,
      minBalanceUi,
      excludedWallets,
      fetched: [],
      supply: {
        value: {
          amount: "0",
          decimals: 0,
          uiAmount: 0,
          uiAmountString: "0"
        }
      }
    }),
    mintExists: false,
    notice: "Token mint account is not live yet; treating holder set as empty."
  };
}

function isMissingMintError(error) {
  return /could not find account|account not found|invalid param/i.test(error?.message || "");
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

function holderSourceLabel(snapshot) {
  if (snapshot.sourceLabel) return snapshot.sourceLabel;
  if (snapshot.source === "static-snapshot") return "Snapshot";
  if (snapshot.source === "holder-indexer") return "Live index";
  if (snapshot.source === "helius") return "Helius";
  if (snapshot.source === "solana-rpc-fallback") return "RPC fallback";
  if (snapshot.source === "solana-rpc") return "Live RPC";
  return "Live";
}

function toDashboardSnapshot(snapshot, walletQuery = "", roundCap = 5) {
  const targetRoundCap = Math.max(1, Math.floor(Number(roundCap) || 5));
  const totalHolderCount = snapshot.holders.length;
  const effectiveRoundCap = Math.min(targetRoundCap, totalHolderCount);
  const cutoffHolder = snapshot.holders[Math.max(0, effectiveRoundCap - 1)];
  const cutoffScore = cutoffHolder?.balanceUi ?? 0;
  const query = walletQuery.trim().toLowerCase();
  const sourceLabel = holderSourceLabel(snapshot);

  const holders = snapshot.holders.map((holder, index) => {
    const rank = index + 1;
    const eligible = rank <= effectiveRoundCap;
    const score = holder.balanceUi;
    return {
      wallet: holder.owner,
      address: holder.owner,
      rank,
      score,
      cutoffScore,
      cutoffDelta: score - cutoffScore,
      cutoffProgress: cutoffScore > 0 ? Math.min(100, (score / cutoffScore) * 100) : eligible ? 100 : 0,
      estimatedNvdax: null,
      name: holder.name,
      solDomain: holder.solDomain,
      domain: holder.domain,
      snsName: holder.snsName,
      holdingSince: holder.holdingSince,
      holdingSeconds: holder.holdingSeconds,
      holdingTimeLabel: holder.holdingTimeLabel,
      timeMultiplier: holder.timeMultiplier,
      balanceWeight: holder.balanceWeight,
      balanceLabel: formatBalance(holder.balanceUi),
      heldLabel: sourceLabel,
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
    sourceLabel,
    live: snapshot.live !== false,
    fallback: Boolean(snapshot.fallback),
    notice: snapshot.notice || "",
    tokenMint: snapshot.tokenMint,
    excludedHolderCount: snapshot.totalExcluded || 0,
    excludedBalanceUi: snapshot.excludedBalanceUi || 0,
    excludedHolders: snapshot.excludedHolders || [],
    roundCap: effectiveRoundCap,
    targetRoundCap,
    totalHolderCount,
    cutoffScore,
    eligibleCount: effectiveRoundCap,
    updatedAt: snapshot.createdAt,
    current,
    holders
  };
}

async function fetchRpcHolderSnapshot(options) {
  const { tokenMint, rpc, minBalanceUi = 0, excludedWallets = [] } = options;
  if (!tokenMint || tokenMint.length < 32) {
    throw new Error("TOKEN_MINT is required for direct RPC holder snapshots.");
  }

  const mintAccount = await rpc("getAccountInfo", [tokenMint, { encoding: "jsonParsed" }]);
  if (!mintAccount?.value) {
    return emptyPrelaunchSnapshot({
      tokenMint,
      source: "solana-rpc",
      minBalanceUi,
      excludedWallets
    });
  }
  let supply;
  try {
    supply = await rpc("getTokenSupply", [tokenMint]);
  } catch (error) {
    if (isMissingMintError(error)) {
      return emptyPrelaunchSnapshot({
        tokenMint,
        tokenProgramId: mintAccount.value.owner || TOKEN_PROGRAM_ID,
        source: "solana-rpc",
        minBalanceUi,
        excludedWallets
      });
    }
    throw error;
  }
  const tokenProgramId = mintAccount?.value?.owner || TOKEN_PROGRAM_ID;
  if (![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(tokenProgramId)) {
    throw new Error(`TOKEN_MINT is not owned by a supported token program: ${tokenProgramId}`);
  }

  const filters = [{ memcmp: { offset: 0, bytes: tokenMint } }];
  if (tokenProgramId === TOKEN_PROGRAM_ID) filters.unshift({ dataSize: 165 });
  if (tokenProgramId === TOKEN_2022_PROGRAM_ID) filters.push({ memcmp: { offset: 165, bytes: [2] } });

  const accounts = await rpc("getProgramAccounts", [
    tokenProgramId,
    {
      encoding: tokenProgramId === TOKEN_2022_PROGRAM_ID ? "base64" : "jsonParsed",
      filters
    }
  ]);

  const fetched = (Array.isArray(accounts) ? accounts : [])
    .map((account, index) =>
      tokenProgramId === TOKEN_2022_PROGRAM_ID
        ? parseBinaryTokenAccount(account, index, Number(supply?.value?.decimals || 0))
        : parseTokenAccount(account, index)
    )
    .filter(Boolean);
  return snapshotFromFetched({
    tokenMint,
    tokenProgramId,
    source: "solana-rpc",
    minBalanceUi,
    excludedWallets,
    fetched,
    supply
  });
}

function heliusUrl() {
  return process.env.SOLANA_RPC_URL || process.env.HELIUS_RPC_URL || "";
}

async function fetchHeliusPage({ url, tokenMint, page, limit }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...rpcOriginHeaders(process.env)
    },
    signal: abortSignal(Number(process.env.HELIUS_TOKEN_ACCOUNT_TIMEOUT_MS || 20_000)),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "jensen-strategy-holders",
      method: "getTokenAccounts",
      params: {
        mint: tokenMint,
        page,
        limit,
        displayOptions: {}
      }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || body.message || `Helius getTokenAccounts failed with ${response.status}.`);
  }
  return body.result || {};
}

async function fetchHeliusHolderSnapshot(options) {
  const { tokenMint, rpc, minBalanceUi = 0, excludedWallets = [] } = options;
  if (!tokenMint || tokenMint.length < 32) {
    throw new Error("TOKEN_MINT is required for Helius holder snapshots.");
  }

  const url = options.heliusUrl || heliusUrl();
  if (!url) {
    throw new Error("Set HELIUS_API_KEY or HELIUS_RPC_URL to scan Token-2022 holders reliably.");
  }

  const mintAccount = await rpc("getAccountInfo", [tokenMint, { encoding: "jsonParsed" }]);
  if (!mintAccount?.value) {
    return emptyPrelaunchSnapshot({
      tokenMint,
      source: "helius",
      minBalanceUi,
      excludedWallets
    });
  }
  let supply;
  try {
    supply = await rpc("getTokenSupply", [tokenMint]);
  } catch (error) {
    if (isMissingMintError(error)) {
      return emptyPrelaunchSnapshot({
        tokenMint,
        tokenProgramId: mintAccount.value.owner || TOKEN_PROGRAM_ID,
        source: "helius",
        minBalanceUi,
        excludedWallets
      });
    }
    throw error;
  }
  const decimals = Number(supply?.value?.decimals || 0);
  const tokenProgramId = mintAccount?.value?.owner || "";
  const limit = Math.min(1000, Math.max(1, Number(process.env.HELIUS_TOKEN_ACCOUNT_PAGE_SIZE || 1000)));
  const maxPages = Math.max(1, Number(process.env.HELIUS_TOKEN_ACCOUNT_MAX_PAGES || 1000));
  const fetched = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchHeliusPage({ url, tokenMint, page, limit });
    const accounts = result.token_accounts || result.tokenAccounts || [];
    if (!Array.isArray(accounts) || accounts.length === 0) break;
    fetched.push(...accounts.map((account, index) => parseHeliusTokenAccount(account, fetched.length + index, decimals)).filter(Boolean));
    if (accounts.length < limit) break;
  }

  return snapshotFromFetched({
    tokenMint,
    tokenProgramId,
    source: "helius",
    minBalanceUi,
    excludedWallets,
    fetched,
    supply
  });
}

async function fetchHolderSnapshot(options) {
  const provider = process.env.HOLDER_SNAPSHOT_PROVIDER || "auto";
  const fallbackEnabled = process.env.ENABLE_RPC_HOLDER_FALLBACK !== "false";
  const canTryHelius = Date.now() >= heliusDisabledUntilMs;
  if ((provider === "helius" || (provider === "auto" && heliusUrl())) && canTryHelius) {
    try {
      return await fetchHeliusHolderSnapshot(options);
    } catch (error) {
      heliusDisabledUntilMs = Date.now() + Number(process.env.HELIUS_FAILURE_TTL_MS || 60_000);
      if (!fallbackEnabled) throw error;
      const fallback = await fetchRpcHolderSnapshot(options);
      return {
        ...fallback,
        source: `${fallback.source}-fallback`,
        providerError: error.message
      };
    }
  }
  return await fetchRpcHolderSnapshot(options);
}

module.exports = {
  fetchHeliusHolderSnapshot,
  fetchHolderSnapshot,
  fetchRpcHolderSnapshot,
  parseWalletList,
  toDashboardSnapshot
};
