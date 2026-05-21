const crypto = require("node:crypto");
const { publicConfig, rpc } = require("./vercel-api");
const { appendAudit, latestRecord, readRecord, saveRecord, stableHash, storageSummary } = require("./admin-store");
const { jupiterQuote, jupiterSwapTransaction } = require("./jupiter-swap");
const { claimCreatorFees, simulateCreatorFeeClaim } = require("./pump-creator-fees");
const { fetchRpcHolderSnapshot, parseWalletList, toDashboardSnapshot } = require("./rpc-holders");
const { tokenBalanceForOwner } = require("./token-utils");
const { distributeWbtcBatch } = require("./wbtc-distributor");

const ACTIONS = [
  {
    id: "validate-config",
    label: "Check Setup",
    group: "Start Here",
    description: "Confirms the admin password, RPC, token mint, wallets, and action wiring are ready.",
    operatorUse: "Click this first before any demo or live operation.",
    proves: "Shows what is ready and what still needs configuration.",
    builtin: validateConfig
  },
  {
    id: "refresh-fee-receipts",
    label: "Refresh Fee Wallet",
    group: "Show Live Data",
    description: "Pulls recent creator-fee wallet transactions and current SOL balance from Solana.",
    operatorUse: "Use this to show that fee intake is being tracked from chain data.",
    proves: "Recent signatures, fee-wallet balance, and receipt history.",
    requires: ["rpcConfigured", "feeWallet"],
    builtin: refreshFeeReceipts
  },
  {
    id: "refresh-holder-list",
    label: "Refresh Holders",
    group: "Show Live Data",
    description: "Builds the holder board from direct Solana RPC, with no Birdeye dependency.",
    operatorUse: "Use this before creating an airdrop list or showing holder eligibility.",
    proves: "Eligible holders, balances, cutoff rank, and snapshot time.",
    webhookEnv: "ADMIN_HOLDER_REFRESH_WEBHOOK_URL",
    requires: ["rpcConfigured", "tokenMint"],
    builtin: refreshHolderList
  },
  {
    id: "check-wbtc-vault",
    label: "Check WBTC Pool",
    group: "Show Live Data",
    description: "Reads the wrapped-BTC balance controlled by the distributor or vault wallet.",
    operatorUse: "Use this to show how much WBTC is available for airdrops.",
    proves: "WBTC mint, vault owner, token accounts, and pool balance.",
    requires: ["rpcConfigured", "distributorWallet", "wbtcMint"],
    builtin: checkWbtcVault
  },
  {
    id: "sync-indexer",
    label: "Sync Public Dashboard",
    group: "Show Live Data",
    description: "Tells the indexer to ingest receipts, balances, snapshots, and manifests.",
    operatorUse: "Use this after on-chain activity so the public dashboard catches up.",
    proves: "The backend can refresh public accounting on demand.",
    webhookEnv: "ADMIN_SYNC_INDEXER_WEBHOOK_URL"
  },
  {
    id: "claim-creator-fees",
    label: "Claim Creator Fees",
    group: "Money Ops",
    description: "Triggers the keeper to collect available Pump.fun creator fees.",
    operatorUse: "Use only when you are ready to move available creator fees into treasury control.",
    proves: "The fee capture leg of the flywheel works.",
    webhookEnv: "ADMIN_CLAIM_CREATOR_FEES_WEBHOOK_URL",
    requires: ["creatorFeeClaimPublicKey"],
    builtin: claimCreatorFees,
    dangerous: true
  },
  {
    id: "simulate-creator-fee-claim",
    label: "Simulate Fee Claim",
    group: "Money Ops",
    description: "Dry-runs the keeper's creator-fee claim path before any signing transaction is sent.",
    operatorUse: "Use this before claiming fees so expected accounts, balances, and gas are visible.",
    proves: "The claim path can be prepared without touching funds.",
    webhookEnv: "ADMIN_SIMULATE_CLAIM_CREATOR_FEES_WEBHOOK_URL",
    requires: ["creatorFeeClaimPublicKey"],
    builtin: simulateCreatorFeeClaim
  },
  {
    id: "quote-wbtc-buy",
    label: "Preview WBTC Buy",
    group: "Money Ops",
    description: "Gets a WBTC swap quote without sending the buy transaction.",
    operatorUse: "Use this before every live buy to check route, expected output, and slippage.",
    proves: "The treasury can price a WBTC conversion before committing.",
    webhookEnv: "ADMIN_QUOTE_WBTC_BUY_WEBHOOK_URL",
    requires: ["wbtcMint"],
    builtin: quoteWbtcBuy
  },
  {
    id: "approve-wbtc-buy",
    label: "Approve Swap Spend",
    group: "Money Ops",
    description: "Approves the configured swap router or keeper spend allowance when the route requires it.",
    operatorUse: "Use this only when the WBTC route preview reports that an approval is missing.",
    proves: "The swap path has the token allowance it needs.",
    webhookEnv: "ADMIN_APPROVE_WBTC_BUY_WEBHOOK_URL",
    builtin: approveWbtcBuy,
    dangerous: true
  },
  {
    id: "execute-wbtc-buy",
    label: "Buy WBTC",
    group: "Money Ops",
    description: "Triggers the keeper to swap available fees into wrapped BTC.",
    operatorUse: "Use after previewing the route and confirming you want to execute the buy.",
    proves: "Creator fees can become WBTC for the holder pool.",
    webhookEnv: "ADMIN_EXECUTE_WBTC_BUY_WEBHOOK_URL",
    requires: ["wbtcMint"],
    builtin: executeWbtcBuy,
    dangerous: true
  },
  {
    id: "record-receipt",
    label: "Publish Receipt",
    group: "Proof",
    description: "Publishes or queues proof for a fee claim, swap, manifest, or airdrop batch.",
    operatorUse: "Use this after a real event when the dashboard needs a verifiable receipt.",
    proves: "The system can turn operations into public proof records.",
    webhookEnv: "ADMIN_RECORD_RECEIPT_WEBHOOK_URL",
    builtin: recordReceipt
  },
  {
    id: "create-holder-snapshot",
    label: "Create Holder Snapshot",
    group: "Snapshots",
    description: "Builds the latest eligible holder list and weighting inputs from the configured holder source.",
    operatorUse: "Use this after fee claim and WBTC buy so the distribution uses current holders.",
    proves: "The holder set is reproducible before it is locked.",
    webhookEnv: "ADMIN_CREATE_HOLDER_SNAPSHOT_WEBHOOK_URL",
    requires: ["rpcConfigured", "tokenMint"],
    builtin: createHolderSnapshot
  },
  {
    id: "finalize-manifest",
    label: "Lock Snapshot",
    group: "Snapshots",
    description: "Turns the latest holder snapshot into the final distribution manifest.",
    operatorUse: "Use this when you are ready to freeze who gets the next WBTC drop.",
    proves: "The airdrop list is deterministic and ready to send.",
    webhookEnv: "ADMIN_FINALIZE_MANIFEST_WEBHOOK_URL",
    requires: ["rpcConfigured", "tokenMint"],
    builtin: finalizeManifest,
    dangerous: true
  },
  {
    id: "simulate-distribution",
    label: "Simulate Distribution",
    group: "Airdrops",
    description: "Computes recipient weights, payout estimates, dust skips, and batch counts without sending WBTC.",
    operatorUse: "Use this before every distribution to check weights, thresholds, and skipped wallets.",
    proves: "The payout math is reproducible before a live batch.",
    requires: ["rpcConfigured", "tokenMint"],
    builtin: simulateDistribution
  },
  {
    id: "generate-distribution-batch",
    label: "Generate Batch",
    group: "Airdrops",
    description: "Creates the next bounded WBTC recipient batch from the locked manifest.",
    operatorUse: "Use this after simulation and snapshot lock, before executing transfers.",
    proves: "The distributor can prepare an idempotent transfer batch.",
    webhookEnv: "ADMIN_GENERATE_DISTRIBUTION_BATCH_WEBHOOK_URL",
    builtin: generateDistributionBatch,
    dangerous: true
  },
  {
    id: "distribute-wbtc",
    label: "Execute WBTC Batch",
    group: "Airdrops",
    description: "Sends the next bounded batch of WBTC transfers to eligible holders.",
    operatorUse: "Use this when you want to actually send the next holder payout batch.",
    proves: "The holder reward distribution leg works on demand.",
    webhookEnv: "ADMIN_DISTRIBUTE_WBTC_WEBHOOK_URL",
    requires: ["rpcConfigured", "wbtcMint"],
    builtin: distributeWbtc,
    dangerous: true
  },
  {
    id: "retry-failed-airdrops",
    label: "Retry Failed Sends",
    group: "Airdrops",
    description: "Retries recipients whose WBTC transfers failed or were interrupted.",
    operatorUse: "Use this after a partial batch failure or network interruption.",
    proves: "Failed payouts can be recovered without rebuilding the whole drop.",
    webhookEnv: "ADMIN_RETRY_FAILED_AIRDROPS_WEBHOOK_URL",
    requires: ["rpcConfigured", "wbtcMint"],
    builtin: distributeWbtc,
    dangerous: true
  },
  {
    id: "open-fallback-claims",
    label: "Open Claim Backup",
    group: "Airdrops",
    description: "Opens a fallback claim window for recipients who could not receive direct transfer.",
    operatorUse: "Use this when direct transfers are not enough for every recipient.",
    proves: "There is a backup path for hard-to-send payouts.",
    webhookEnv: "ADMIN_OPEN_FALLBACK_CLAIMS_WEBHOOK_URL",
    dangerous: true
  },
  {
    id: "close-fallback-claims",
    label: "Close Claim Backup",
    group: "Airdrops",
    description: "Closes the fallback claim window.",
    operatorUse: "Use this after the backup claim period is complete.",
    proves: "Fallback claim windows are operator-controlled.",
    webhookEnv: "ADMIN_CLOSE_FALLBACK_CLAIMS_WEBHOOK_URL",
    dangerous: true
  },
  {
    id: "pause-protocol",
    label: "Pause Everything",
    group: "Emergency",
    description: "Triggers the pause authority for keeper, distribution, or protocol operations.",
    operatorUse: "Use this if a wallet, route, manifest, or config looks wrong.",
    proves: "Operations can be stopped intentionally.",
    webhookEnv: "ADMIN_PAUSE_PROTOCOL_WEBHOOK_URL",
    dangerous: true
  },
  {
    id: "unpause-protocol",
    label: "Resume Operations",
    group: "Emergency",
    description: "Re-enables operations after the issue is resolved.",
    operatorUse: "Use this only after confirming config and funds are safe.",
    proves: "Paused operations can be restarted cleanly.",
    webhookEnv: "ADMIN_UNPAUSE_PROTOCOL_WEBHOOK_URL",
    dangerous: true
  }
];

const HOLDING_TIME_TIERS = [
  { minDays: 90, multiplier: 1.5, label: "90d+" },
  { minDays: 30, multiplier: 1, label: "30-89d" },
  { minDays: 7, multiplier: 0.5, label: "7-29d" },
  { minDays: 0, multiplier: 0.25, label: "0-6d" }
];

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const exact = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(exact)) return exact[0] || "";
  return exact || "";
}

function configuredAdminSecret() {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_API_TOKEN || "";
}

function isAdminAuthorized(headers) {
  const expected = configuredAdminSecret();
  if (!expected) return false;

  const direct = headerValue(headers, "x-admin-password");
  const authorization = headerValue(headers, "authorization");
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";

  return safeEqual(direct, expected) || safeEqual(bearer, expected);
}

function requirementsMet(action, config) {
  return (action.requires || []).every((key) => Boolean(config[key]));
}

function publicAction(action, config) {
  const webhookUrl = action.webhookEnv ? process.env[action.webhookEnv] || process.env.ADMIN_ACTION_WEBHOOK_URL || "" : "";
  const directReady = Boolean(action.builtin) && requirementsMet(action, config);
  const configured = Boolean(directReady || webhookUrl || (action.builtin && !action.requires));
  return {
    id: action.id,
    label: action.label,
    group: action.group,
    description: action.description,
    operatorUse: action.operatorUse || "",
    proves: action.proves || "",
    dangerous: Boolean(action.dangerous),
    builtin: Boolean(action.builtin),
    webhookEnv: action.webhookEnv || "",
    requires: action.requires || [],
    configured,
    mode: webhookUrl ? "webhook" : directReady || (action.builtin && !action.requires) ? "direct" : action.builtin ? "needs-config" : "unconfigured"
  };
}

function adminStatus() {
  const config = publicConfig();
  const actionList = ACTIONS.map((action) => publicAction(action, config));
  const creatorConfigured = Boolean(config.creatorFeeClaimPublicKey || process.env.CREATOR_KEYPAIR_PATH || process.env.CREATOR_PRIVATE_KEY_BASE58);
  const normalizedActionList = actionList.map((action) =>
    action.requires.includes("creatorFeeClaimPublicKey")
      ? {
          ...action,
          configured: action.configured || creatorConfigured,
          mode: action.mode === "needs-config" && creatorConfigured ? "direct" : action.mode
        }
      : action
  );
  const required = [
    ["ADMIN_PASSWORD or ADMIN_API_TOKEN", Boolean(configuredAdminSecret())],
    ["SOLANA_RPC_URL", config.rpcConfigured],
    ["PUBLIC_TOKEN_MINT", Boolean(config.tokenMint)],
    ["PUBLIC_FEE_WALLET", Boolean(config.feeWallet)],
    ["PUBLIC_DISTRIBUTOR_WALLET", Boolean(config.distributorWallet)],
    ["PUBLIC_WBTC_MINT", Boolean(config.wbtcMint)],
    ["CREATOR_PUBLIC_KEY or CREATOR_KEYPAIR_PATH", Boolean(config.creatorFeeClaimPublicKey || process.env.CREATOR_KEYPAIR_PATH || process.env.CREATOR_PRIVATE_KEY_BASE58)]
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    adminConfigured: Boolean(configuredAdminSecret()),
    publicConfig: config,
    required: required.map(([name, configured]) => ({ name, configured })),
    actions: normalizedActionList,
    storage: storageSummary(),
    weighting: {
      formula: "holderWeight = tokenBalance * holdingTimeMultiplier",
      tiers: HOLDING_TIME_TIERS,
      defaultRoundCap: Number(process.env.HOLDER_ROUND_CAP || 128),
      minPayout: Number(process.env.MIN_AIRDROP_UI_AMOUNT || 0),
      maxRecipientsPerBatch: Number(process.env.MAX_RECIPIENTS_PER_BATCH || 12),
      maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS || 100)
    },
    summary: {
      totalActions: normalizedActionList.length,
      configuredActions: normalizedActionList.filter((action) => action.configured).length,
      webhookActions: normalizedActionList.filter((action) => action.mode === "webhook").length,
      directActions: normalizedActionList.filter((action) => action.mode === "direct").length
    }
  };
}

function findAction(actionId) {
  return ACTIONS.find((action) => action.id === actionId);
}

async function callWebhook(action, payload) {
  const url = process.env[action.webhookEnv] || process.env.ADMIN_ACTION_WEBHOOK_URL || "";
  if (!url) return null;

  const timeoutMs = Number(process.env.ADMIN_WEBHOOK_TIMEOUT_MS || 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const secret = process.env.ADMIN_ACTION_WEBHOOK_SECRET || "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}`, "x-admin-action-secret": secret } : {})
      },
      body: JSON.stringify({
        action: action.id,
        dryRun: payload.dryRun !== false,
        requestedAt: new Date().toISOString(),
        payload: payload.payload || {}
      }),
      signal: controller.signal
    });
    const text = await response.text();
    let body = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // Webhooks can return logs or plain text.
    }

    return {
      ok: response.ok,
      status: response.status,
      mode: "webhook",
      urlConfigured: true,
      body
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runAdminAction(actionId, payload = {}) {
  const action = findAction(actionId);
  if (!action) {
    const error = new Error(`Unknown admin action "${actionId}".`);
    error.statusCode = 404;
    throw error;
  }

  if (action.dangerous && payload.confirm !== true) {
    const error = new Error(`Action "${actionId}" requires explicit confirmation.`);
    error.statusCode = 400;
    throw error;
  }

  const requestedAt = new Date().toISOString();
  appendAudit({
    action: action.id,
    label: action.label,
    status: "started",
    dryRun: payload.dryRun !== false,
    requestedAt,
    payload: payload.payload || {}
  });

  const webhookResult = action.webhookEnv ? await callWebhook(action, payload) : null;
  if (webhookResult) {
    appendAudit({
      action: action.id,
      label: action.label,
      status: webhookResult.ok ? "completed" : "failed",
      mode: "webhook",
      requestedAt,
      result: webhookResult
    });
    return {
      ok: webhookResult.ok,
      action: action.id,
      label: action.label,
      completedAt: new Date().toISOString(),
      result: webhookResult
    };
  }

  if (!action.builtin) {
    const error = new Error(
      `Action "${actionId}" is not configured. Set ${action.webhookEnv || "ADMIN_ACTION_WEBHOOK_URL"} to enable it.`
    );
    error.statusCode = 409;
    throw error;
  }

  const result = await action.builtin(payload);
  appendAudit({
    action: action.id,
    label: action.label,
    status: "completed",
    mode: "direct",
    requestedAt,
    result
  });
  return {
    ok: true,
    action: action.id,
    label: action.label,
    completedAt: new Date().toISOString(),
    result: {
      mode: "direct",
      ...result
    }
  };
}

async function validateConfig() {
  return adminStatus();
}

async function refreshFeeReceipts() {
  const config = publicConfig();
  if (!config.feeWallet) {
    throw new Error("PUBLIC_FEE_WALLET is not configured.");
  }

  const limit = Number(process.env.FEE_RECEIPT_LIMIT || 10);
  const [signatures, lamports, wsol] = await Promise.all([
    rpc("getSignaturesForAddress", [config.feeWallet, { limit }]),
    rpc("getBalance", [config.feeWallet]),
    tokenBalanceForOwner({ rpc, owner: config.feeWallet, mint: config.wsolMint })
  ]);

  return {
    configured: true,
    feeWallet: config.feeWallet,
    solBalance: lamports.value / 1_000_000_000,
    wsolMint: config.wsolMint,
    wsolBalance: wsol.balance,
    wsolAccountCount: wsol.accountCount,
    totalSolAndWsolBalance: lamports.value / 1_000_000_000 + wsol.balance,
    receiptCount: signatures.length,
    receipts: signatures.map((item) => ({
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime,
      status: item.err ? "failed" : "confirmed"
    }))
  };
}

async function refreshHolderList(payload = {}) {
  const config = publicConfig();
  const minBalanceUi = Number(process.env.HOLDER_SNAPSHOT_MIN_BALANCE || 0);
  const excludedWallets = [
    ...parseWalletList(process.env.HOLDER_EXCLUDED_WALLETS || ""),
    config.feeWallet,
    config.distributorWallet
  ].filter(Boolean);
  const snapshot = await fetchRpcHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc,
    minBalanceUi,
    excludedWallets
  });
  const roundCap = Number(payload.payload?.roundCap || process.env.HOLDER_ROUND_CAP || 128);

  return {
    configured: true,
    source: snapshot.source,
    tokenMint: snapshot.tokenMint,
    totalFetched: snapshot.totalFetched,
    totalEligible: snapshot.totalEligible,
    totalBalanceUi: snapshot.totalBalanceUi,
    dashboard: toDashboardSnapshot(snapshot, payload.payload?.wallet || "", roundCap)
  };
}

async function createHolderSnapshot(payload = {}) {
  const refreshed = await refreshHolderList(payload);
  const snapshot = saveRecord("snapshots", {
    type: "holder-snapshot",
    source: refreshed.source,
    tokenMint: refreshed.tokenMint,
    totalFetched: refreshed.totalFetched,
    totalEligible: refreshed.totalEligible,
    totalBalanceUi: refreshed.totalBalanceUi,
    roundCap: refreshed.dashboard.roundCap,
    cutoffScore: refreshed.dashboard.cutoffScore,
    holderCount: refreshed.dashboard.holders.length,
    dashboard: refreshed.dashboard,
    payload: payload.payload || {}
  });

  return {
    ...refreshed,
    snapshotId: snapshot.id,
    storagePath: "snapshots",
    locked: false
  };
}

async function checkWbtcVault() {
  const config = publicConfig();
  if (!config.distributorWallet) {
    throw new Error("PUBLIC_DISTRIBUTOR_WALLET is not configured.");
  }
  if (!config.wbtcMint) {
    throw new Error("PUBLIC_WBTC_MINT is not configured.");
  }

  const accounts = await rpc("getTokenAccountsByOwner", [
    config.distributorWallet,
    { mint: config.wbtcMint },
    { encoding: "jsonParsed" }
  ]);
  const balance = accounts.value.reduce((total, account) => {
    const amount = account.account.data.parsed.info.tokenAmount.uiAmount || 0;
    return total + amount;
  }, 0);

  return {
    configured: true,
    owner: config.distributorWallet,
    mint: config.wbtcMint,
    accountCount: accounts.value.length,
    balance
  };
}

async function quoteWbtcBuy(payload = {}) {
  const config = publicConfig();
  return await jupiterQuote({
    outputMint: config.wbtcMint,
    payload
  });
}

async function approveWbtcBuy() {
  return {
    configured: true,
    provider: "jupiter",
    status: "not_required",
    message: "Solana/Jupiter swaps do not use ERC-20-style token approvals. The signer authorizes the swap transaction directly."
  };
}

async function executeWbtcBuy(payload = {}) {
  const config = publicConfig();
  const body = payload.payload || {};
  const userPublicKey = body.userPublicKey || process.env.JUPITER_SWAP_USER_PUBLIC_KEY || config.jupiterSwapUserPublicKey || config.distributorWallet || config.feeWallet;
  return await jupiterSwapTransaction({
    outputMint: config.wbtcMint,
    userPublicKey,
    payload
  });
}

function holdingDays(holder) {
  const direct = Number(holder.holdingDays ?? holder.daysHeld ?? holder.heldDays ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const firstSeen = holder.firstSeenAt || holder.firstHeldAt || holder.createdAt;
  if (!firstSeen) return 30;

  const started = new Date(firstSeen).getTime();
  if (!Number.isFinite(started)) return 30;
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
}

function holdingMultiplier(days) {
  const tier = HOLDING_TIME_TIERS.find((item) => days >= item.minDays) || HOLDING_TIME_TIERS[HOLDING_TIME_TIERS.length - 1];
  return tier.multiplier;
}

function distributionOptions(payload = {}) {
  const body = payload.payload || {};
  return {
    roundCap: Number(body.roundCap || process.env.HOLDER_ROUND_CAP || 128),
    rewardPool: Number(body.rewardPoolWbtc || body.rewardPool || 0),
    minPayout: Number(body.minPayout || process.env.MIN_AIRDROP_UI_AMOUNT || 0),
    maxRecipientsPerBatch: Number(body.batchSize || process.env.MAX_RECIPIENTS_PER_BATCH || 12),
    limit: Number(body.limit || 50),
    snapshotId: body.snapshotId || ""
  };
}

function computeDistributionFromHolders({ holders, tokenMint, snapshotCreatedAt, payload = {} }) {
  const config = publicConfig();
  const options = distributionOptions(payload);
  const candidates = holders.slice(0, options.roundCap).map((holder, index) => {
    const balance = Number(holder.balanceUi ?? holder.balance ?? holder.score ?? 0);
    const days = holdingDays(holder);
    const multiplier = holdingMultiplier(days);
    const score = balance * multiplier;
    return {
      rank: index + 1,
      wallet: holder.owner || holder.wallet || holder.address,
      balance,
      holdingDays: days,
      multiplier,
      score
    };
  });
  const totalScore = candidates.reduce((sum, holder) => sum + holder.score, 0);
  const recipients = candidates.map((holder) => {
    const share = totalScore > 0 ? holder.score / totalScore : 0;
    const reward = options.rewardPool * share;
    return {
      ...holder,
      share,
      reward,
      status: reward >= options.minPayout ? "pay" : "skip_dust"
    };
  });
  const payable = recipients.filter((holder) => holder.status === "pay");

  return {
    configured: true,
    dryRun: true,
    tokenMint,
    wbtcMint: config.wbtcMint,
    snapshotCreatedAt,
    rewardPool: options.rewardPool,
    minPayout: options.minPayout,
    roundCap: options.roundCap,
    totalScore,
    recipientCount: recipients.length,
    payableCount: payable.length,
    skippedCount: recipients.length - payable.length,
    batchSize: options.maxRecipientsPerBatch,
    batchCount: Math.ceil(payable.length / Math.max(1, options.maxRecipientsPerBatch)),
    formula: "holderWeight = tokenBalance * holdingTimeMultiplier; reward = rewardPool * holderWeight / totalWeight",
    tiers: HOLDING_TIME_TIERS,
    recipients,
    previewRecipients: recipients.slice(0, options.limit)
  };
}

async function simulateDistribution(payload = {}) {
  const config = publicConfig();
  const options = distributionOptions(payload);
  const storedSnapshot = options.snapshotId ? readRecord("snapshots", options.snapshotId) : latestRecord("snapshots");
  if (storedSnapshot?.dashboard?.holders?.length) {
    const simulated = computeDistributionFromHolders({
      holders: storedSnapshot.dashboard.holders.map((holder) => ({
        owner: holder.wallet || holder.address,
        balanceUi: holder.score,
        holdingDays: holder.holdingDays,
        createdAt: storedSnapshot.createdAt
      })),
      tokenMint: storedSnapshot.tokenMint,
      snapshotCreatedAt: storedSnapshot.createdAt,
      payload
    });
    return {
      ...simulated,
      snapshotId: storedSnapshot.id,
      recipients: simulated.previewRecipients
    };
  }

  const roundCap = Number(payload.payload?.roundCap || process.env.HOLDER_ROUND_CAP || 128);
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

  const simulated = computeDistributionFromHolders({
    holders: snapshot.holders,
    tokenMint: config.tokenMint,
    snapshotCreatedAt: snapshot.createdAt,
    payload: {
      ...payload,
      payload: {
        ...(payload.payload || {}),
        roundCap
      }
    }
  });

  return {
    ...simulated,
    recipients: simulated.previewRecipients
  };
}

async function finalizeManifest(payload = {}) {
  const options = distributionOptions(payload);
  let snapshot = options.snapshotId ? readRecord("snapshots", options.snapshotId) : latestRecord("snapshots");
  if (!snapshot) {
    const created = await createHolderSnapshot(payload);
    snapshot = readRecord("snapshots", created.snapshotId);
  }
  if (!snapshot?.dashboard?.holders?.length) {
    throw new Error("No holder snapshot is available to lock.");
  }

  const simulated = computeDistributionFromHolders({
    holders: snapshot.dashboard.holders.map((holder) => ({
      owner: holder.wallet || holder.address,
      balanceUi: holder.score,
      holdingDays: holder.holdingDays,
      createdAt: snapshot.createdAt
    })),
    tokenMint: snapshot.tokenMint,
    snapshotCreatedAt: snapshot.createdAt,
    payload
  });
  const recipients = simulated.recipients.filter((recipient) => recipient.status === "pay");
  const manifestPayload = {
    type: "distribution-manifest",
    snapshotId: snapshot.id,
    tokenMint: snapshot.tokenMint,
    wbtcMint: publicConfig().wbtcMint,
    rewardPool: simulated.rewardPool,
    minPayout: simulated.minPayout,
    roundCap: simulated.roundCap,
    formula: simulated.formula,
    tiers: HOLDING_TIME_TIERS,
    totalScore: simulated.totalScore,
    payableCount: recipients.length,
    skippedCount: simulated.skippedCount,
    recipients
  };
  const manifestHash = stableHash(manifestPayload);
  const existingManifest = latestRecord("manifests");
  if (existingManifest?.manifestHash === manifestHash) {
    return {
      ...existingManifest,
      duplicate: true,
      message: "Latest manifest already matches this snapshot and distribution config."
    };
  }

  const manifest = saveRecord("manifests", {
    ...manifestPayload,
    manifestHash,
    status: "locked"
  });
  return {
    manifestId: manifest.id,
    manifestHash,
    snapshotId: snapshot.id,
    payableCount: recipients.length,
    skippedCount: simulated.skippedCount,
    rewardPool: simulated.rewardPool,
    status: manifest.status
  };
}

async function generateDistributionBatch(payload = {}) {
  const body = payload.payload || {};
  const manifest = readRecord("manifests", body.manifestId || body.snapshotId || "latest");
  if (!manifest) {
    throw new Error("No locked manifest exists. Lock a snapshot before generating a batch.");
  }
  const batchSize = Math.max(1, Number(body.batchSize || process.env.MAX_RECIPIENTS_PER_BATCH || manifest.recipients.length || 1));
  const batchIndex = Math.max(0, Number(body.batchIndex || 0));
  const start = batchIndex * batchSize;
  const recipients = manifest.recipients.slice(start, start + batchSize);
  if (!recipients.length) {
    throw new Error(`No recipients available for batch index ${batchIndex}.`);
  }

  const batchPayload = {
    type: "distribution-batch",
    manifestId: manifest.id,
    manifestHash: manifest.manifestHash,
    batchIndex,
    batchSize,
    start,
    endExclusive: start + recipients.length,
    recipients
  };
  const batchHash = stableHash(batchPayload);
  const existing = latestRecord("batches");
  if (existing?.batchHash === batchHash) {
    return {
      ...existing,
      duplicate: true,
      message: "Latest batch already matches this manifest window."
    };
  }

  const batch = saveRecord("batches", {
    ...batchPayload,
    batchHash,
    status: "prepared",
    execution: {
      status: "not_sent",
      txSignature: "",
      sentAt: ""
    }
  });

  return {
    batchId: batch.id,
    batchHash,
    manifestId: manifest.id,
    batchIndex,
    recipientCount: recipients.length,
    status: batch.status
  };
}

async function recordReceipt(payload = {}) {
  const body = payload.payload || {};
  const receiptType = body.receiptType || body.type || "manual";
  const signature = body.signature || body.txSignature || "";
  const manifestId = body.manifestId || "";
  const batchId = body.batchId || "";
  const receipt = saveRecord("receipts", {
    type: "receipt",
    receiptType,
    signature,
    manifestId,
    batchId,
    status: body.status || (signature ? "confirmed" : "recorded"),
    notes: body.notes || "",
    payload: body
  });
  return {
    receiptId: receipt.id,
    receiptType,
    signature,
    manifestId,
    batchId,
    status: receipt.status
  };
}

async function distributeWbtc(payload = {}) {
  const body = payload.payload || {};
  const batch = readRecord("batches", body.batchId || "latest");
  if (!batch) {
    throw new Error("No prepared distribution batch exists. Generate a batch before executing WBTC distribution.");
  }
  if (batch.execution?.status === "confirmed" && !body.forceResend) {
    return {
      batchId: batch.id,
      status: "already_confirmed",
      signature: batch.execution.txSignature,
      message: "This batch is already confirmed. Pass forceResend only if you intentionally want to resend the same recipients."
    };
  }

  const result = await distributeWbtcBatch({
    batch,
    config: publicConfig(),
    payload
  });
  const updated = saveRecord("batches", {
    ...batch,
    status: result.dryRun ? "prepared" : "sent",
    execution: {
      status: result.status,
      dryRun: result.dryRun,
      txSignature: result.signature || "",
      sentAt: result.dryRun ? "" : new Date().toISOString(),
      signer: result.signer,
      sourceAta: result.sourceAta,
      instructionCount: result.instructionCount,
      recipientCount: result.recipientCount
    }
  });

  if (result.signature) {
    saveRecord("receipts", {
      type: "receipt",
      receiptType: "wbtc-distribution",
      signature: result.signature,
      manifestId: batch.manifestId,
      batchId: batch.id,
      status: "confirmed",
      payload: {
        recipientCount: result.recipientCount,
        sourceAta: result.sourceAta
      }
    });
  }

  return {
    ...result,
    batchId: updated.id,
    manifestId: batch.manifestId
  };
}

module.exports = {
  adminStatus,
  isAdminAuthorized,
  runAdminAction
};
