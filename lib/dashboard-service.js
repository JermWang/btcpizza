const { buildDistributionPolicy, currentDistributionEpoch, distributionPreview } = require("./distribution-policy");
const { listRecords, readRecord, storageSummary } = require("./admin-store");
const { fetchHolderSnapshot, parseWalletList, toDashboardSnapshot } = require("./rpc-holders");
const { hasSolanaRpc, rpcRequest } = require("./solana-rpc");
const { tokenBalanceForOwner } = require("./token-utils");

const DEFAULT_PROJECT_TOKEN_MINT = "GhqoqCtgSQs5NMYtDbMB6tqjucBwHWwXaUjwm12Epump";
const DEFAULT_PROJECT_WALLET = "EogJsJrUXwarSaZY25H7Ed3K1E9cV2PAZLKJoDWLhP4h";
const DEFAULT_WBTC_MINT = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
const DEFAULT_WSOL_MINT = "So11111111111111111111111111111111111111112";

function envValue(env, key, fallback = "") {
  return env[key] || fallback;
}

function solanaRpcUrl(env = process.env) {
  return hasSolanaRpc(env) ? "configured" : "";
}

function publicConfig(env = process.env) {
  const wallet = env.WALLET || DEFAULT_PROJECT_WALLET;
  const tokenMint = env.TOKEN_MINT || DEFAULT_PROJECT_TOKEN_MINT;
  const distributionPolicy = buildDistributionPolicy(env);
  const distributionEpoch = currentDistributionEpoch(distributionPolicy);
  const distributionSchedule = distributionPreview(distributionPolicy);
  const holderIndexerUrlConfigured = Boolean(env.HOLDER_INDEXER_API_URL);

  return {
    cluster: "mainnet-beta",
    rpcConfigured: Boolean(solanaRpcUrl(env)),
    devCreatorWallet: wallet,
    feeWallet: wallet,
    contractAddress: tokenMint,
    tokenMint,
    wbtcMint: env.REWARD_MINT || DEFAULT_WBTC_MINT,
    wsolMint: DEFAULT_WSOL_MINT,
    distributorWallet: wallet,
    jupiterConfigured: true,
    jupiterApiBaseUrl: "https://api.jup.ag/swap/v1",
    jupiterSwapUserPublicKey: wallet,
    creatorFeeClaimPublicKey: wallet,
    pumpPortalLocalApiUrl: "https://pumpportal.fun/api/trade-local",
    holderIndexerUrlConfigured,
    holderSnapshotProvider: env.HOLDER_SNAPSHOT_PROVIDER || "auto",
    holderDataMode: holderIndexerUrlConfigured ? "live-indexer" : env.HOLDER_SNAPSHOT_PROVIDER || "auto",
    distributionStartedAt: distributionPolicy.startedAt,
    distributionMode: distributionPolicy.mode,
    distributionBaseIntervalSeconds: distributionPolicy.baseIntervalSeconds,
    distributionIntervalMultiplier: distributionPolicy.intervalMultiplier,
    distributionBaseHolderCap: distributionPolicy.baseHolderCap,
    distributionHolderCapMultiplier: distributionPolicy.holderCapMultiplier,
    distributionPreviewEpochs: distributionPolicy.previewEpochs,
    distributionScheduleSeconds: distributionSchedule.map((step) => step.seconds),
    distributionScheduleLabels: distributionSchedule.map((step) => step.label),
    distributionHolderCaps: distributionSchedule.map((step) => step.holderCap),
    currentDistributionEpoch: distributionEpoch,
    distributionIntervalSeconds: distributionEpoch.seconds,
    distributionIntervalLabel: distributionEpoch.label,
    distributionRoundCap: distributionEpoch.holderCap,
    solscanBaseUrl: env.PUBLIC_SOLSCAN_BASE_URL || "https://solscan.io",
    coingeckoApiUrl: env.PUBLIC_COINGECKO_API_URL || "https://api.coingecko.com/api/v3"
  };
}

async function rpc(method, params, env = process.env) {
  return await rpcRequest(method, params, env);
}

function launchSafeStatus(status, reason, extra = {}) {
  return {
    configured: false,
    status,
    reason,
    live: false,
    ...extra
  };
}

async function feeReceipts(env = process.env) {
  const config = publicConfig(env);
  if (!config.feeWallet) {
    return launchSafeStatus("awaiting_fee_wallet", "Fee wallet is not configured yet.", { receipts: [] });
  }

  if (!solanaRpcUrl(env)) {
    return launchSafeStatus("awaiting_rpc", "Fee wallet is set; live receipt polling starts when SOLANA_RPC_URL or HELIUS_RPC_URL is configured.", {
      feeWallet: config.feeWallet,
      receipts: []
    });
  }

  try {
    const rpcForEnv = (method, params) => rpc(method, params, env);
    const [signatures, lamports, wsol] = await Promise.all([
      rpcForEnv("getSignaturesForAddress", [config.feeWallet, { limit: Number(env.FEE_RECEIPT_LIMIT || 10) }]),
      rpcForEnv("getBalance", [config.feeWallet]),
      tokenBalanceForOwner({ rpc: rpcForEnv, owner: config.feeWallet, mint: config.wsolMint })
    ]);

    return {
      configured: true,
      status: "live",
      live: true,
      feeWallet: config.feeWallet,
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
  } catch (error) {
    return launchSafeStatus("temporarily_unavailable", "Fee wallet is configured, but live Solana receipts are temporarily unavailable.", {
      feeWallet: config.feeWallet,
      error: error.message,
      receipts: []
    });
  }
}

async function tokenBalance(owner, mint, env = process.env) {
  if (!owner || !mint) {
    return launchSafeStatus("awaiting_addresses", "Token balance needs an owner and mint.", {
      owner: owner || "",
      mint: mint || "",
      accountCount: 0,
      balance: null
    });
  }

  if (!solanaRpcUrl(env)) {
    return launchSafeStatus("awaiting_rpc", "Token balance polling starts when SOLANA_RPC_URL or HELIUS_RPC_URL is configured.", {
      owner,
      mint,
      accountCount: 0,
      balance: null
    });
  }

  try {
    return await tokenBalanceForOwner({ rpc: (method, params) => rpc(method, params, env), owner, mint });
  } catch (error) {
    return launchSafeStatus("temporarily_unavailable", "Token balance is configured, but live Solana polling is temporarily unavailable.", {
      owner,
      mint,
      error: error.message,
      accountCount: 0,
      balance: null
    });
  }
}

function decorateIndexerSnapshot(body) {
  return {
    ...body,
    configured: body.configured !== false,
    live: body.live !== false,
    fallback: false,
    source: body.source || "holder-indexer",
    sourceLabel: body.sourceLabel || "Live holder indexer",
    status: body.status || "live"
  };
}

async function fetchIndexerSnapshot(wallet, env = process.env) {
  const url = new URL(env.HOLDER_INDEXER_API_URL);
  if (wallet) url.searchParams.set("wallet", wallet);
  const result = await fetch(url, { headers: { accept: "application/json" } });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw new Error(body.error || body.message || `Holder indexer failed: ${result.status}`);
  }
  return decorateIndexerSnapshot(body);
}

async function fetchConfiguredProviderSnapshot(wallet, env = process.env) {
  const config = publicConfig(env);
  const provider = env.HOLDER_SNAPSHOT_PROVIDER || "auto";
  const canUseProvider = ["solana-rpc", "helius", "auto"].includes(provider) || env.ENABLE_RPC_HOLDER_FALLBACK !== "false";
  if (!canUseProvider || !solanaRpcUrl(env)) return null;

  const excludedWallets = [
    ...parseWalletList(env.HOLDER_EXCLUDED_WALLETS || ""),
    config.feeWallet,
    config.distributorWallet
  ].filter(Boolean);
  const snapshot = await fetchHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc: (method, params) => rpc(method, params, env),
    minBalanceUi: Number(env.HOLDER_SNAPSHOT_MIN_BALANCE || 0),
    excludedWallets
  });

  const roundCap = currentDistributionEpoch(buildDistributionPolicy(env)).holderCap;
  return toDashboardSnapshot(snapshot, wallet || "", roundCap);
}

async function holderSnapshot(wallet = "", env = process.env) {
  let fallbackReason = "";

  if (env.HOLDER_INDEXER_API_URL) {
    try {
      return await fetchIndexerSnapshot(wallet, env);
    } catch (error) {
      fallbackReason = error.message;
    }
  }

  try {
    const providerSnapshot = await fetchConfiguredProviderSnapshot(wallet, env);
    if (providerSnapshot) return providerSnapshot;
  } catch (error) {
    fallbackReason = fallbackReason || error.message;
  }

  return launchSafeStatus("holder_snapshot_unavailable", "No live holder source is available. Configure HOLDER_SNAPSHOT_PROVIDER=solana-rpc, helius, auto, or HOLDER_INDEXER_API_URL.", {
    error: fallbackReason,
    wallet: wallet || "",
    current: null,
    holders: []
  });
}

function shortRecordId(id = "") {
  if (!id || id.length <= 18) return id || "";
  return `${id.slice(0, 14)}...${id.slice(-8)}`;
}

function matchesCurrentToken(record, config) {
  if (!record) return false;
  if (!record.tokenMint) return true;
  return record.tokenMint === config.tokenMint;
}

function publicSnapshotRecord(snapshot) {
  if (!snapshot) return null;
  const dashboard = snapshot.dashboard || {};
  return {
    id: snapshot.id || "",
    label: shortRecordId(snapshot.id),
    status: snapshot.status || "created",
    createdAt: snapshot.createdAt || snapshot.updatedAt || "",
    tokenMint: snapshot.tokenMint || dashboard.tokenMint || "",
    source: dashboard.sourceLabel || dashboard.source || snapshot.source || "",
    totalHolderCount: dashboard.totalHolderCount ?? dashboard.holders?.length ?? snapshot.totalEligible ?? 0,
    eligibleCount: dashboard.eligibleCount ?? snapshot.totalEligible ?? 0,
    excludedHolderCount: dashboard.excludedHolderCount ?? 0
  };
}

function publicManifestRecord(manifest) {
  if (!manifest) return null;
  return {
    id: manifest.id || "",
    label: shortRecordId(manifest.id),
    status: manifest.status || "locked",
    createdAt: manifest.createdAt || manifest.updatedAt || "",
    tokenMint: manifest.tokenMint || "",
    wbtcMint: manifest.wbtcMint || "",
    snapshotId: manifest.snapshotId || "",
    manifestHash: manifest.manifestHash || "",
    rewardPool: manifest.rewardPool ?? 0,
    payableCount: manifest.payableCount ?? manifest.recipients?.length ?? 0,
    skippedCount: manifest.skippedCount ?? 0,
    roundCap: manifest.roundCap ?? 0
  };
}

function publicBatchRecord(batch) {
  if (!batch) return null;
  return {
    id: batch.id || "",
    label: shortRecordId(batch.id),
    status: batch.execution?.status || batch.status || "prepared",
    createdAt: batch.createdAt || batch.updatedAt || "",
    tokenMint: batch.tokenMint || "",
    wbtcMint: batch.wbtcMint || "",
    manifestId: batch.manifestId || "",
    batchHash: batch.batchHash || "",
    batchIndex: batch.batchIndex ?? 0,
    batchSize: batch.batchSize ?? batch.recipients?.length ?? 0,
    recipientCount: batch.execution?.recipientCount ?? batch.recipients?.length ?? 0,
    signature: batch.execution?.txSignature || ""
  };
}

function publicReceiptRecord(receipt) {
  if (!receipt) return null;
  return {
    id: receipt.id || "",
    label: shortRecordId(receipt.id),
    type: receipt.receiptType || receipt.type || "receipt",
    status: receipt.status || "recorded",
    createdAt: receipt.createdAt || receipt.updatedAt || "",
    signature: receipt.signature || receipt.txSignature || "",
    manifestId: receipt.manifestId || "",
    batchId: receipt.batchId || ""
  };
}

function publicEpochRecord(epoch) {
  if (!epoch) return null;
  return {
    id: epoch.id || "",
    label: shortRecordId(epoch.id),
    status: epoch.status || "",
    createdAt: epoch.createdAt || epoch.updatedAt || "",
    epochIndex: epoch.epochIndex ?? null,
    epochNumber: epoch.epochNumber ?? null,
    startedAt: epoch.startedAt || "",
    endedAt: epoch.endedAt || "",
    intervalLabel: epoch.intervalLabel || "",
    rewardPoolWbtc: epoch.rewardPoolWbtc ?? 0,
    payableCount: epoch.payableCount ?? 0,
    batchCount: epoch.batchCount ?? 0,
    signature: epoch.signature || "",
    screenshotUrl: epoch.screenshotUrl || "",
    message: epoch.message || ""
  };
}

function publicAutomationState(automation) {
  if (!automation) {
    return {
      active: false,
      status: "not_armed",
      nextEpochIndex: 0,
      nextEpochEndsAt: "",
      message: "Epoch automation is not armed yet."
    };
  }

  return {
    active: Boolean(automation.active),
    status: automation.status || (automation.active ? "armed" : "paused"),
    startedAt: automation.startedAt || "",
    nextEpochIndex: Math.max(0, Number(automation.nextEpochIndex || 0)),
    nextEpochEndsAt: automation.nextEpochEndsAt || "",
    lastCompletedEpochIndex: automation.lastCompletedEpochIndex ?? null,
    lastCompletedAt: automation.lastCompletedAt || "",
    lastEpochId: automation.lastEpochId || "",
    lastError: automation.lastError || "",
    lastScreenshotUrl: automation.lastScreenshotUrl || ""
  };
}

async function operationsSummary(env = process.env) {
  const config = publicConfig(env);

  try {
    const [snapshots, manifests, batches, receipts, epochs, automation, storage] = await Promise.all([
      listRecords("snapshots"),
      listRecords("manifests"),
      listRecords("batches"),
      listRecords("receipts"),
      listRecords("epochs"),
      readRecord("automation", "epoch-automation"),
      storageSummary()
    ]);
    const latestSnapshot = snapshots.find((snapshot) => matchesCurrentToken(snapshot, config));
    const latestManifest = manifests.find((manifest) => matchesCurrentToken(manifest, config));
    const latestBatch = batches.find((batch) => matchesCurrentToken(batch, config));

    return {
      configured: true,
      status: "live",
      live: true,
      generatedAt: new Date().toISOString(),
      storage: {
        backend: storage.backend,
        auditCount: storage.auditCount,
        receiptCount: storage.receiptCount,
        manifestCount: storage.manifestCount,
        batchCount: storage.batchCount
      },
      automation: publicAutomationState(automation),
      latestSnapshot: publicSnapshotRecord(latestSnapshot),
      latestManifest: publicManifestRecord(latestManifest),
      latestBatch: publicBatchRecord(latestBatch),
      latestEpoch: publicEpochRecord(epochs[0]),
      receipts: receipts.slice(0, 5).map(publicReceiptRecord).filter(Boolean)
    };
  } catch (error) {
    return launchSafeStatus("operations_unavailable", "Stored launch operations are temporarily unavailable.", {
      error: error.message,
      storage: null,
      automation: publicAutomationState(null),
      latestSnapshot: null,
      latestManifest: null,
      latestBatch: null,
      latestEpoch: null,
      receipts: []
    });
  }
}

module.exports = {
  feeReceipts,
  holderSnapshot,
  operationsSummary,
  publicConfig,
  rpc,
  solanaRpcUrl,
  tokenBalance
};
