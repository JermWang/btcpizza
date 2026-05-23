const { publicConfig, rpc } = require("./vercel-api");
const { appendAudit, listRecords, readRecord, saveRecord, stableHash, storageSummary } = require("./admin-store");
const { buildDistributionPolicy, currentDistributionEpoch, epochStep } = require("./distribution-policy");
const { jupiterQuote, jupiterSwapTransaction } = require("./jupiter-swap");
const { claimCreatorFees, simulateCreatorFeeClaim } = require("./pump-creator-fees");
const { fetchHolderSnapshot, parseWalletList, toDashboardSnapshot } = require("./rpc-holders");
const { adminAuthConfigured, adminSecretMatches, cronAuthConfigured } = require("./secret-auth");
const { hasConfiguredKeypair } = require("./solana-keypair");
const { tokenBalanceForOwner } = require("./token-utils");
const { distributeWbtcBatch } = require("./wbtc-distributor");
const rewardsStore = require("./rewards/store");

const CREATOR_KEYPAIR_CONFIG   = { base58: ["WALLET_PRIVATE_KEY"], file: [] };
const SWAP_KEYPAIR_CONFIG       = { base58: ["WALLET_PRIVATE_KEY"], file: [] };
const DISTRIBUTOR_KEYPAIR_CONFIG = { base58: ["WALLET_PRIVATE_KEY"], file: [] };

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
    label: "Check NVDAx Pool",
    group: "Show Live Data",
    description: "Reads the NVDAx balance controlled by the distributor or vault wallet.",
    operatorUse: "Use this to show how much NVDAx is available for airdrops.",
    proves: "NVDAx mint, vault owner, token accounts, and pool balance.",
    requires: ["rpcConfigured", "distributorWallet", "wbtcMint"],
    builtin: checkWbtcVault
  },
  {
    id: "official-live-go",
    label: "Official Live GO",
    group: "Launch",
    description: "Runs the launch-day sequence and, in live mode, arms the continuous epoch runner.",
    operatorUse: "Use dry run first, then switch off Dry run and enable Confirm live when launch and automation are intentional.",
    proves: "The configured launch path can run from one controlled action with the same backend path as Vercel.",
    requires: ["rpcConfigured", "feeWallet", "tokenMint", "distributorWallet", "wbtcMint"],
    builtin: officialLiveGo,
    dangerous: true
  },
  {
    id: "run-due-epoch",
    label: "Run Due Epoch",
    group: "Launch",
    description: "Runs the next scheduled epoch only when its displayed time trigger is due.",
    operatorUse: "Use this for cron, monitors, or an emergency manual tick after Official Live GO is armed.",
    proves: "Epochs can continue without a browser session after the launch is armed.",
    requires: ["rpcConfigured", "feeWallet", "tokenMint", "distributorWallet", "wbtcMint"],
    builtin: runDueEpochAction,
    dangerous: true
  },
  {
    id: "pause-epoch-automation",
    label: "Pause Epoch Runner",
    group: "Emergency",
    description: "Pauses the continuous epoch runner without changing existing manifests or batches.",
    operatorUse: "Use this if an env value, wallet, route, or holder snapshot looks wrong.",
    proves: "Scheduled epochs can be stopped intentionally.",
    builtin: pauseEpochAutomation,
    dangerous: true
  },
  {
    id: "sync-indexer",
    label: "Sync Public Dashboard",
    group: "Show Live Data",
    description: "Tells the indexer to ingest receipts, balances, snapshots, and manifests.",
    operatorUse: "Use this after on-chain activity so the public dashboard catches up.",
    proves: "The backend can refresh public accounting on demand.",
    webhookEnv: "ADMIN_SYNC_INDEXER_WEBHOOK_URL",
    builtin: syncPublicDashboard
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
    label: "Preview NVDAx Buy",
    group: "Money Ops",
    description: "Gets a NVDAx swap quote without sending the buy transaction.",
    operatorUse: "Use this before every live buy to check route, expected output, and slippage.",
    proves: "The treasury can price a NVDAx conversion before committing.",
    webhookEnv: "ADMIN_QUOTE_WBTC_BUY_WEBHOOK_URL",
    requires: ["wbtcMint"],
    builtin: quoteWbtcBuy
  },
  {
    id: "approve-wbtc-buy",
    label: "Approve Swap Spend",
    group: "Money Ops",
    description: "Approves the configured swap router or keeper spend allowance when the route requires it.",
    operatorUse: "Use this only when the NVDAx route preview reports that an approval is missing.",
    proves: "The swap path has the token allowance it needs.",
    webhookEnv: "ADMIN_APPROVE_WBTC_BUY_WEBHOOK_URL",
    builtin: approveWbtcBuy,
    dangerous: true
  },
  {
    id: "execute-wbtc-buy",
    label: "Buy NVDAx",
    group: "Money Ops",
    description: "Triggers the keeper to swap available fees into NVDAx.",
    operatorUse: "Use after previewing the route and confirming you want to execute the buy.",
    proves: "Creator fees can become NVDAx for the holder pool.",
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
    operatorUse: "Use this after fee claim and NVDAx buy so the distribution uses current holders.",
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
    operatorUse: "Use this when you are ready to freeze who gets the next NVDAx drop.",
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
    description: "Computes recipient weights, payout estimates, dust skips, and batch counts without sending NVDAx.",
    operatorUse: "Use this before every distribution to check weights, thresholds, and skipped wallets.",
    proves: "The payout math is reproducible before a live batch.",
    requires: ["rpcConfigured", "tokenMint"],
    builtin: simulateDistribution
  },
  {
    id: "generate-distribution-batch",
    label: "Generate Batch",
    group: "Airdrops",
    description: "Creates the next bounded NVDAx recipient batch from the locked manifest.",
    operatorUse: "Use this after simulation and snapshot lock, before executing transfers.",
    proves: "The distributor can prepare an idempotent transfer batch.",
    webhookEnv: "ADMIN_GENERATE_DISTRIBUTION_BATCH_WEBHOOK_URL",
    builtin: generateDistributionBatch,
    dangerous: true
  },
  {
    id: "distribute-wbtc",
    label: "Execute NVDAx Batch",
    group: "Airdrops",
    description: "Sends the next bounded batch of NVDAx transfers to eligible holders.",
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
    description: "Retries recipients whose NVDAx transfers failed or were interrupted.",
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
    builtin: openFallbackClaims,
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
    builtin: closeFallbackClaims,
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
    builtin: pauseProtocol,
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
    builtin: unpauseProtocol,
    dangerous: true
  },
  {
    id: "archive-epoch",
    label: "Archive Epoch",
    group: "Cleanup",
    description: "Marks an epoch as archived so it no longer appears in the active dashboard.",
    operatorUse: "Use this to hide test or old epochs without deleting data.",
    proves: "Epochs can be organized without data loss.",
    builtin: archiveEpochAction,
    dangerous: true
  },
  {
    id: "delete-epoch",
    label: "Delete Epoch",
    group: "Cleanup",
    description: "Permanently removes an epoch and all its holders, batches, and receipts.",
    operatorUse: "Use this to clean up test epochs. Cannot be undone.",
    proves: "Test data can be fully removed.",
    builtin: deleteEpochAction,
    dangerous: true
  },
  {
    id: "reset-test-data",
    label: "Reset Test Data",
    group: "Cleanup",
    description: "Deletes every epoch and cascades delete all holders, batches, and receipts.",
    operatorUse: "Use this before going live to wipe all test epochs. Cannot be undone.",
    proves: "The database can be reset to a clean state.",
    builtin: resetTestDataAction,
    dangerous: true
  },
  {
    id: "go-live-reset",
    label: "Go Live Reset",
    group: "Launch",
    description: "Archives and deletes all test epochs, wipes holders/batches/receipts, and creates a clean epoch 0 ready for production.",
    operatorUse: "Use this once before real launch. It resets the rewards DB and starts a fresh epoch with the current TOKEN_MINT.",
    proves: "The system can be cleanly reset for production without running scripts.",
    builtin: goLiveResetAction,
    dangerous: true
  }
];

const HOLDING_TIME_TIERS = [
  { minDays: 90, multiplier: 1.5, label: "90d+" },
  { minDays: 30, multiplier: 1, label: "30-89d" },
  { minDays: 7, multiplier: 0.5, label: "7-29d" },
  { minDays: 0, multiplier: 0.25, label: "0-6d" }
];

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const exact = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(exact)) return exact[0] || "";
  return exact || "";
}

function currentRoundCap() {
  return currentDistributionEpoch(buildDistributionPolicy(process.env)).holderCap;
}

function automationId() {
  return "epoch-automation";
}

function nowIso() {
  return new Date().toISOString();
}

function publicSiteUrl() {
  const explicit = process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.ADMIN_EPOCH_SCREENSHOT_URL || "";
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

function policyWithAutomationStart(state = null) {
  const policy = buildDistributionPolicy(process.env);
  if (state?.startedAt) policy.startedAt = state.startedAt;
  return policy;
}

function epochWindow(policy, startedAt, epochIndex) {
  const startMs = Date.parse(startedAt || "");
  if (!Number.isFinite(startMs)) throw new Error("Epoch automation has no valid startedAt timestamp.");
  const safeIndex = Math.max(0, Math.floor(Number(epochIndex) || 0));
  let offsetSeconds = 0;
  for (let index = 0; index < safeIndex; index += 1) {
    offsetSeconds += epochStep(policy, index).seconds;
  }
  const step = epochStep(policy, safeIndex);
  const windowStartMs = startMs + offsetSeconds * 1000;
  const windowEndMs = windowStartMs + step.seconds * 1000;
  return {
    ...step,
    epochIndex: safeIndex,
    startedAt: new Date(windowStartMs).toISOString(),
    endsAt: new Date(windowEndMs).toISOString(),
    due: Date.now() >= windowEndMs
  };
}

async function readEpochAutomation() {
  return await readRecord("automation", automationId());
}

async function saveEpochAutomation(update) {
  const existing = (await readEpochAutomation()) || {};
  const policy = policyWithAutomationStart(existing);
  const nextEpochIndex = Math.max(0, Number(update.nextEpochIndex ?? existing.nextEpochIndex ?? 0));
  const startedAt = update.startedAt || existing.startedAt || nowIso();
  const nextWindow = epochWindow(policyWithAutomationStart({ startedAt }), startedAt, nextEpochIndex);
  return await saveRecord("automation", {
    ...existing,
    ...update,
    id: automationId(),
    type: "epoch-automation",
    startedAt,
    nextEpochIndex,
    nextEpochEndsAt: update.active === false ? existing.nextEpochEndsAt || nextWindow.endsAt : nextWindow.endsAt,
    active: update.active ?? existing.active ?? false,
    updatedAt: nowIso()
  });
}

function automationPublicState(state) {
  if (!state) {
    return {
      active: false,
      status: "not_armed",
      nextEpochIndex: 0,
      nextEpochEndsAt: "",
      message: "Epoch automation is not armed yet."
    };
  }
  const policy = policyWithAutomationStart(state);
  const nextWindow = epochWindow(policy, state.startedAt, state.nextEpochIndex || 0);
  return {
    active: Boolean(state.active),
    status: state.active ? state.status || "armed" : state.status || "paused",
    startedAt: state.startedAt,
    lastCompletedEpochIndex: state.lastCompletedEpochIndex ?? null,
    lastCompletedAt: state.lastCompletedAt || "",
    lastEpochId: state.lastEpochId || "",
    nextEpochIndex: nextWindow.epochIndex,
    nextEpochNumber: nextWindow.epochIndex + 1,
    nextEpochEndsAt: nextWindow.endsAt,
    nextIntervalSeconds: nextWindow.seconds,
    nextIntervalLabel: nextWindow.label,
    nextRoundCap: nextWindow.holderCap,
    due: state.active ? nextWindow.due : false,
    lastError: state.lastError || "",
    lastScreenshotUrl: state.lastScreenshotUrl || "",
    message: state.active
      ? `Epoch ${nextWindow.epochIndex + 1} is armed and due at ${nextWindow.endsAt}.`
      : "Epoch automation is paused."
  };
}

function isAdminAuthorized(headers) {
  const direct = headerValue(headers, "x-admin-password");
  const authorization = headerValue(headers, "authorization");
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";

  return adminSecretMatches(direct) || adminSecretMatches(bearer);
}

function adminAuthError() {
  return adminAuthConfigured()
    ? "Admin password is incorrect."
    : "ADMIN_PASSWORD or ADMIN_API_TOKEN is not configured in the server environment.";
}

function creatorClaimReady() {
  return hasConfiguredKeypair(CREATOR_KEYPAIR_CONFIG);
}

function swapSignerReady() {
  return hasConfiguredKeypair(SWAP_KEYPAIR_CONFIG);
}

function distributorSignerReady() {
  return hasConfiguredKeypair(DISTRIBUTOR_KEYPAIR_CONFIG);
}

function signerRoutingReady() {
  return creatorClaimReady() && swapSignerReady() && distributorSignerReady();
}

function liveAutomationMissing(config = publicConfig()) {
  return [
    ["ADMIN_PASSWORD or ADMIN_API_TOKEN", adminAuthConfigured()],
    ["SOLANA_RPC_URL", config.rpcConfigured],
    ["TOKEN_MINT", Boolean(config.tokenMint)],
    ["REWARD_MINT", Boolean(config.wbtcMint)],
    ["WALLET", Boolean(config.feeWallet)],
    ["WALLET_PRIVATE_KEY or signer routing override", signerRoutingReady()],
    ["CRON_SECRET", cronAuthConfigured()]
  ]
    .filter(([, configured]) => !configured)
    .map(([name]) => name);
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

async function adminStatus() {
  const config = publicConfig();
  const actionList = ACTIONS.map((action) => publicAction(action, config));
  const creatorConfigured = creatorClaimReady(config);
  const normalizedActionList = actionList.map((action) =>
    action.requires.includes("creatorFeeClaimPublicKey")
      ? {
          ...action,
          configured: action.configured || creatorConfigured,
          mode: action.mode === "needs-config" && creatorConfigured ? "direct" : action.mode
        }
      : action
  );
  const automation = await readEpochAutomation();
  const distributionPolicy = policyWithAutomationStart(automation);
  const distributionEpoch = currentDistributionEpoch(distributionPolicy);
  const required = [
    ["ADMIN_PASSWORD or ADMIN_API_TOKEN", adminAuthConfigured()],
    ["SOLANA_RPC_URL", config.rpcConfigured],
    ["TOKEN_MINT", Boolean(config.tokenMint)],
    ["REWARD_MINT", Boolean(config.wbtcMint)],
    ["WALLET", Boolean(config.feeWallet)],
    ["WALLET_PRIVATE_KEY or signer routing override", signerRoutingReady()],
    ["CRON_SECRET", cronAuthConfigured()]
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    adminConfigured: adminAuthConfigured(),
    publicConfig: config,
    required: required.map(([name, configured]) => ({ name, configured })),
    actions: normalizedActionList,
    storage: await storageSummary(),
    automation: automationPublicState(automation),
    automationConfig: {
      cronSecretConfigured: cronAuthConfigured(),
      screenshotWebhookConfigured: Boolean(process.env.ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL),
      screenshotTargetUrl: process.env.ADMIN_EPOCH_SCREENSHOT_URL || publicSiteUrl()
    },
    weighting: {
      formula: "holderWeight = tokenBalance * holdingTimeMultiplier",
      tiers: HOLDING_TIME_TIERS,
      defaultRoundCap: distributionEpoch.holderCap,
      baseRoundCap: distributionPolicy.baseHolderCap,
      holderCapMultiplier: distributionPolicy.holderCapMultiplier,
      currentEpoch: distributionEpoch.epochIndex + 1,
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
  await appendAudit({
    action: action.id,
    label: action.label,
    status: "started",
    dryRun: payload.dryRun !== false,
    requestedAt,
    payload: payload.payload || {}
  });

  const webhookResult = action.webhookEnv ? await callWebhook(action, payload) : null;
  if (webhookResult) {
    await appendAudit({
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
  await appendAudit({
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
  return await adminStatus();
}

async function syncPublicDashboard() {
  const [storage, automation] = await Promise.all([storageSummary(), readEpochAutomation()]);
  return {
    configured: true,
    status: "synced",
    publicConfig: publicConfig(),
    storage,
    automation: automationPublicState(automation),
    message: "Public dashboard data sources are reachable and current storage state was refreshed."
  };
}

async function openFallbackClaims(payload = {}) {
  const body = payload.payload || {};
  const record = await saveRecord("claims", {
    id: "fallback-claims",
    type: "fallback-claims",
    status: "open",
    openedAt: nowIso(),
    notes: body.notes || ""
  });
  return {
    configured: true,
    status: record.status,
    claimWindowId: record.id,
    openedAt: record.openedAt
  };
}

async function closeFallbackClaims(payload = {}) {
  const body = payload.payload || {};
  const existing = (await readRecord("claims", "fallback-claims")) || {};
  const record = await saveRecord("claims", {
    ...existing,
    id: "fallback-claims",
    type: "fallback-claims",
    status: "closed",
    closedAt: nowIso(),
    notes: body.notes || existing.notes || ""
  });
  return {
    configured: true,
    status: record.status,
    claimWindowId: record.id,
    closedAt: record.closedAt
  };
}

async function pauseProtocol(payload = {}) {
  const body = payload.payload || {};
  const automation = await pauseEpochAutomation();
  const record = await saveRecord("protocol", {
    id: "protocol-state",
    type: "protocol-state",
    status: "paused",
    pausedAt: nowIso(),
    reason: body.reason || "admin_action"
  });
  return {
    configured: true,
    status: record.status,
    pausedAt: record.pausedAt,
    automation
  };
}

async function unpauseProtocol(payload = {}) {
  const body = payload.payload || {};
  const record = await saveRecord("protocol", {
    id: "protocol-state",
    type: "protocol-state",
    status: "active",
    resumedAt: nowIso(),
    reason: body.reason || "admin_action"
  });
  return {
    configured: true,
    status: record.status,
    resumedAt: record.resumedAt,
    message: "Protocol state is active. Epoch automation remains controlled by Official Live GO or Run Due Epoch."
  };
}

async function refreshFeeReceipts() {
  const config = publicConfig();
  if (!config.feeWallet) {
    throw new Error("WALLET is not configured.");
  }

  const limit = Number(process.env.FEE_RECEIPT_LIMIT || 10);
  const signatures = await rpc("getSignaturesForAddress", [config.feeWallet, { limit }]);
  const lamports = await rpc("getBalance", [config.feeWallet]);
  const wsol = await tokenBalanceForOwner({ rpc, owner: config.feeWallet, mint: config.wsolMint });

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
  const snapshot = await fetchHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc,
    minBalanceUi,
    excludedWallets
  });
  const roundCap = Number(payload.payload?.roundCap || currentRoundCap());

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
  const snapshot = await saveRecord("snapshots", {
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
    throw new Error("WALLET is not configured.");
  }
  if (!config.wbtcMint) {
    throw new Error("REWARD_MINT is not configured.");
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
  if (!firstSeen) return 0;

  const started = new Date(firstSeen).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 86_400_000));
}

function holdingMultiplier(days) {
  const tier = HOLDING_TIME_TIERS.find((item) => days >= item.minDays) || HOLDING_TIME_TIERS[HOLDING_TIME_TIERS.length - 1];
  return tier.multiplier;
}

function distributionOptions(payload = {}) {
  const body = payload.payload || {};
  return {
    roundCap: Number(body.roundCap ?? currentRoundCap()),
    rewardPool: Number(body.rewardPoolWbtc ?? body.rewardPool ?? 0),
    minPayout: Number(body.minPayout ?? process.env.MIN_AIRDROP_UI_AMOUNT ?? 0),
    maxRecipientsPerBatch: Number(body.batchSize ?? process.env.MAX_RECIPIENTS_PER_BATCH ?? 12),
    limit: Number(body.limit ?? 50),
    snapshotId: body.snapshotId || ""
  };
}

function sameAddress(a, b) {
  return String(a || "") === String(b || "");
}

function snapshotMatchesCurrentToken(snapshot, config = publicConfig()) {
  return Boolean(snapshot && sameAddress(snapshot.tokenMint, config.tokenMint));
}

function manifestMatchesCurrentToken(manifest, config = publicConfig()) {
  return Boolean(
    manifest &&
      sameAddress(manifest.tokenMint, config.tokenMint) &&
      (!manifest.wbtcMint || sameAddress(manifest.wbtcMint, config.wbtcMint))
  );
}

function batchMatchesCurrentToken(batch, manifest, config = publicConfig()) {
  if (!batch) return false;
  if (batch.tokenMint && !sameAddress(batch.tokenMint, config.tokenMint)) return false;
  if (batch.wbtcMint && !sameAddress(batch.wbtcMint, config.wbtcMint)) return false;
  return manifest ? manifestMatchesCurrentToken(manifest, config) : Boolean(batch.tokenMint);
}

function tokenMismatchError(recordType, record, config = publicConfig()) {
  return new Error(
    `${recordType} ${record?.id || "record"} belongs to token ${record?.tokenMint || "unknown"}, but current TOKEN_MINT is ${config.tokenMint}. Refresh holders and create a new snapshot before distributing.`
  );
}

async function latestManifestForCurrentToken(config = publicConfig()) {
  const manifests = await listRecords("manifests");
  return manifests.find((manifest) => manifestMatchesCurrentToken(manifest, config)) || null;
}

async function latestBatchForCurrentToken(config = publicConfig()) {
  const batches = await listRecords("batches");
  for (const batch of batches) {
    const manifest = batch.manifestId ? await readRecord("manifests", batch.manifestId) : null;
    if (batchMatchesCurrentToken(batch, manifest, config)) return batch;
  }
  return null;
}

function computeDistributionFromHolders({ holders, tokenMint, snapshotCreatedAt, payload = {} }) {
  const config = publicConfig();
  const options = distributionOptions(payload);
  const targetRoundCap = Math.max(1, Math.floor(Number(options.roundCap) || currentRoundCap()));
  const totalHolderCount = holders.length;
  const effectiveRoundCap = Math.min(targetRoundCap, totalHolderCount);
  const candidates = holders.slice(0, effectiveRoundCap).map((holder, index) => {
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
    roundCap: effectiveRoundCap,
    targetRoundCap,
    totalHolderCount,
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
  const storedSnapshot = options.snapshotId ? await readRecord("snapshots", options.snapshotId) : null;
  if (options.snapshotId && !storedSnapshot) {
    throw new Error(`Snapshot ${options.snapshotId} was not found. Refresh holders and create a current snapshot before simulating.`);
  }
  if (options.snapshotId && storedSnapshot && !snapshotMatchesCurrentToken(storedSnapshot, config)) {
    throw tokenMismatchError("Snapshot", storedSnapshot, config);
  }
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

  const roundCap = Number(payload.payload?.roundCap || currentRoundCap());
  const excludedWallets = [
    ...parseWalletList(process.env.HOLDER_EXCLUDED_WALLETS || ""),
    config.feeWallet,
    config.distributorWallet
  ].filter(Boolean);
  const snapshot = await fetchHolderSnapshot({
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
  const config = publicConfig();
  const options = distributionOptions(payload);
  const dryRun = payload.dryRun !== false;
  let snapshot = options.snapshotId ? await readRecord("snapshots", options.snapshotId) : null;
  if (options.snapshotId && !snapshot) {
    throw new Error(`Snapshot ${options.snapshotId} was not found. Refresh holders and create a current snapshot before locking.`);
  }
  if (options.snapshotId && snapshot && !snapshotMatchesCurrentToken(snapshot, config)) {
    throw tokenMismatchError("Snapshot", snapshot, config);
  }
  if (!snapshot) {
    if (dryRun) {
      const refreshed = await refreshHolderList(payload);
      snapshot = {
        id: "dry_run_current_snapshot",
        tokenMint: refreshed.tokenMint,
        createdAt: new Date().toISOString(),
        dashboard: refreshed.dashboard
      };
    } else {
      const created = await createHolderSnapshot(payload);
      snapshot = await readRecord("snapshots", created.snapshotId);
    }
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
    wbtcMint: config.wbtcMint,
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
  const existingManifest = await latestManifestForCurrentToken(config);
  if (existingManifest?.manifestHash === manifestHash) {
    return {
      ...existingManifest,
      duplicate: true,
      message: "Latest manifest already matches this snapshot and distribution config."
    };
  }

  if (dryRun) {
    return {
      dryRun: true,
      manifestHash,
      snapshotId: snapshot.id,
      tokenMint: snapshot.tokenMint,
      payableCount: recipients.length,
      skippedCount: simulated.skippedCount,
      rewardPool: simulated.rewardPool,
      status: "dry_run",
      message: "Dry run built the current holder manifest but did not lock or store it."
    };
  }

  const manifest = await saveRecord("manifests", {
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
  const config = publicConfig();
  const body = payload.payload || {};
  const dryRun = payload.dryRun !== false;
  const manifest = body.manifestId || body.snapshotId ? await readRecord("manifests", body.manifestId || body.snapshotId) : await latestManifestForCurrentToken(config);
  if (!manifest) {
    throw new Error("No locked manifest exists for the current token. Refresh holders and lock a current snapshot before generating a batch.");
  }
  if (!manifestMatchesCurrentToken(manifest, config)) {
    throw tokenMismatchError("Manifest", manifest, config);
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
    tokenMint: manifest.tokenMint,
    wbtcMint: manifest.wbtcMint,
    batchIndex,
    batchSize,
    start,
    endExclusive: start + recipients.length,
    recipients
  };
  const batchHash = stableHash(batchPayload);
  const existing = await latestBatchForCurrentToken(config);
  if (existing?.batchHash === batchHash) {
    return {
      ...existing,
      duplicate: true,
      message: "Latest batch already matches this manifest window."
    };
  }

  if (dryRun) {
    return {
      dryRun: true,
      batchHash,
      manifestId: manifest.id,
      tokenMint: manifest.tokenMint,
      batchIndex,
      recipientCount: recipients.length,
      status: "dry_run",
      message: "Dry run built the current-token batch but did not store it."
    };
  }

  const batch = await saveRecord("batches", {
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
  const cfg = publicConfig();
  const solscanBase = cfg.solscanBaseUrl || "https://solscan.io";
  const solscanUrl = signature ? `${solscanBase.replace(/\/$/, "")}/tx/${signature}` : "";

  const receipt = await saveRecord("receipts", {
    type: "receipt",
    receiptType,
    signature,
    manifestId,
    batchId,
    status: body.status || (signature ? "confirmed" : "recorded"),
    notes: body.notes || "",
    payload: body
  });

  // Also write to public rewards DB so the community dashboard shows it
  try {
    const currentEpoch = await rewardsStore.currentEpoch();
    await rewardsStore.saveReceipt({
      epochId: currentEpoch?.id || null,
      batchId: batchId || null,
      recipientWallet: body.recipientWallet || body.recipient || "",
      rewardMint: cfg.wbtcMint || "",
      amountRaw: String(body.amountRaw || body.amount || 0),
      amountUi: String(body.amountUi || body.amount || ""),
      signature,
      solscanUrl,
      status: body.status || (signature ? "confirmed" : "recorded"),
      notes: `${receiptType}: ${body.notes || ""}`
    });
  } catch {
    // Best-effort; don't block admin receipt on rewards DB
  }

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
  const config = publicConfig();
  const body = payload.payload || {};
  const batch = body.batchId ? await readRecord("batches", body.batchId) : await latestBatchForCurrentToken(config);
  if (!batch) {
    throw new Error("No prepared distribution batch exists for the current token. Generate a current-token batch before executing NVDAx distribution.");
  }
  const manifest = batch.manifestId ? await readRecord("manifests", batch.manifestId) : null;
  if (!batchMatchesCurrentToken(batch, manifest, config)) {
    throw tokenMismatchError("Batch", batch, config);
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
    config,
    payload
  });
  const updated = await saveRecord("batches", {
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
    await saveRecord("receipts", {
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

    // Also write per-recipient receipts to the public rewards DB
    try {
      const currentEpoch = await rewardsStore.currentEpoch();
      const solscanBase = config.solscanBaseUrl || "https://solscan.io";
      const solscanUrl = `${solscanBase.replace(/\/$/, "")}/tx/${result.signature}`;
      const recipients = batch.recipients || [];
      for (const recipient of recipients) {
        await rewardsStore.saveReceipt({
          epochId: currentEpoch?.id || null,
          batchId: batch.id || null,
          recipientWallet: recipient.wallet || "",
          rewardMint: config.wbtcMint || "",
          amountRaw: String(recipient.rewardRaw || recipient.amountRaw || 0),
          amountUi: String(recipient.rewardUi || recipient.reward || recipient.amount || ""),
          signature: result.signature,
          solscanUrl,
          status: "confirmed",
          notes: `wbtc-distribution batch ${batch.batchIndex || 0}`
        });
      }
    } catch {
      // Best-effort; don't block distribution on rewards DB
    }
  }

  return {
    ...result,
    batchId: updated.id,
    manifestId: batch.manifestId
  };
}

function stepResult(name, result) {
  return {
    name,
    ok: true,
    result
  };
}

function stepError(name, error) {
  return {
    name,
    ok: false,
    error: error.message || String(error)
  };
}

async function runLaunchStep(steps, name, fn, { optional = false } = {}) {
  try {
    const result = await fn();
    steps.push(stepResult(name, result));
    return result;
  } catch (error) {
    steps.push(stepError(name, error));
    if (!optional) throw error;
    return null;
  }
}

async function captureEpochScreenshot(epochRecord) {
  const targetUrl = (process.env.ADMIN_EPOCH_SCREENSHOT_URL || publicSiteUrl() || "").replace(/\/$/, "");
  const webhookUrl = process.env.ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL || "";
  const requestedAt = nowIso();
  const baseRecord = {
    type: "epoch-screenshot",
    epochId: epochRecord.id,
    epochIndex: epochRecord.epochIndex,
    targetUrl,
    requestedAt
  };

  if (!webhookUrl) {
    return await saveRecord("screenshots", {
      ...baseRecord,
      configured: false,
      status: "not_configured",
      message: "Set ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL to capture a dashboard screenshot at each epoch close."
    });
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.ADMIN_ACTION_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.ADMIN_ACTION_WEBHOOK_SECRET}` } : {})
    },
    body: JSON.stringify({
      targetUrl,
      epoch: epochRecord,
      requestedAt
    })
  });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Screenshot hooks may return a plain URL or log body.
  }
  const screenshotUrl =
    (body && typeof body === "object" && (body.screenshotUrl || body.imageUrl || body.url || body.assetUrl)) ||
    (typeof body === "string" && /^https?:\/\//i.test(body) ? body : "");
  const record = await saveRecord("screenshots", {
    ...baseRecord,
    configured: true,
    ok: response.ok,
    status: response.ok ? "captured" : "failed",
    httpStatus: response.status,
    screenshotUrl,
    body
  });
  if (!response.ok) {
    throw new Error(`Epoch screenshot webhook failed with HTTP ${response.status}.`);
  }
  return record;
}

async function completeEpochAutomation(state, epochRecord, updates = {}) {
  const nextEpochIndex = epochRecord.epochIndex + 1;
  return await saveEpochAutomation({
    ...state,
    ...updates,
    active: true,
    status: "armed",
    runningEpochIndex: null,
    runningStartedAt: "",
    lastCompletedEpochIndex: epochRecord.epochIndex,
    lastCompletedAt: nowIso(),
    lastEpochId: epochRecord.id,
    nextEpochIndex,
    lastError: ""
  });
}

async function runScheduledEpoch({ force = false, source = "manual", payload = {} } = {}) {
  const state = await readEpochAutomation();
  if (!state?.active) {
    return {
      status: "idle",
      active: false,
      message: "Epoch automation is not armed. Run Official Live GO in confirmed live mode first."
    };
  }

  const policy = policyWithAutomationStart(state);
  const nextWindow = epochWindow(policy, state.startedAt, state.nextEpochIndex || 0);
  if (!force && !nextWindow.due) {
    return {
      status: "not_due",
      active: true,
      epochIndex: nextWindow.epochIndex,
      nextEpochEndsAt: nextWindow.endsAt,
      message: `Epoch ${nextWindow.epochIndex + 1} is not due until ${nextWindow.endsAt}.`
    };
  }

  const config = publicConfig();
  const missing = liveAutomationMissing(config);
  if (missing.length) {
    const error = new Error(`Epoch automation is blocked until ${missing.join(", ")} is configured.`);
    error.statusCode = 409;
    throw error;
  }

  await saveEpochAutomation({
    ...state,
    active: true,
    status: "running",
    runningEpochIndex: nextWindow.epochIndex,
    runningStartedAt: nowIso()
  });

  const steps = [];
  const epochPayload = {
    action: "run-due-epoch",
    dryRun: false,
    confirm: true,
    payload: {
      ...payload,
      epochIndex: nextWindow.epochIndex,
      epochStartedAt: nextWindow.startedAt,
      epochEndsAt: nextWindow.endsAt,
      roundCap: nextWindow.holderCap
    }
  };

  const epochRecordBase = {
    type: "distribution-epoch",
    source,
    policy: {
      mode: policy.mode,
      baseIntervalSeconds: policy.baseIntervalSeconds,
      intervalMultiplier: policy.intervalMultiplier,
      baseHolderCap: policy.baseHolderCap,
      holderCapMultiplier: policy.holderCapMultiplier
    },
    epochIndex: nextWindow.epochIndex,
    epochNumber: nextWindow.epochIndex + 1,
    startedAt: nextWindow.startedAt,
    endedAt: nextWindow.endsAt,
    intervalSeconds: nextWindow.seconds,
    intervalLabel: nextWindow.label,
    roundCap: nextWindow.holderCap,
    status: "running",
    steps
  };
  let epochRecord = await saveRecord("epochs", epochRecordBase);

  try {
    const claim = await runLaunchStep(steps, "claim-creator-fees", () => claimCreatorFees(epochPayload), { optional: true });
    if (claim?.signature) {
      await runLaunchStep(steps, "record-creator-fee-receipt", () =>
        recordReceipt({
          ...epochPayload,
          payload: {
            ...epochPayload.payload,
            receiptType: "creator-fee-claim",
            signature: claim.signature,
            status: claim.status
          }
        })
      );
    }
    await runLaunchStep(steps, "refresh-fee-receipts", () => refreshFeeReceipts(), { optional: true });
    const buy = await runLaunchStep(steps, "execute-wbtc-buy", () => executeWbtcBuy(epochPayload));
    if (buy?.signature) {
      await runLaunchStep(steps, "record-wbtc-buy-receipt", () =>
        recordReceipt({
          ...epochPayload,
          payload: {
            ...epochPayload.payload,
            receiptType: "wbtc-buy",
            signature: buy.signature,
            status: buy.status || buy.submitted?.signature ? "confirmed" : "recorded"
          }
        })
      );
    }

    const wbtcVault = await runLaunchStep(steps, "check-wbtc-vault", () => checkWbtcVault());
    const rewardPoolWbtc = Number(wbtcVault.balance || 0);
    if (rewardPoolWbtc <= 0) {
      epochRecord = await saveRecord("epochs", {
        ...epochRecord,
        status: "skipped_no_rewards",
        rewardPoolWbtc,
        steps,
        message: "Epoch completed without distribution because the NVDAx pool is zero after fee claim and buy."
      });
      const screenshot = await runLaunchStep(steps, "capture-dashboard-screenshot", () => captureEpochScreenshot(epochRecord), { optional: true });
      epochRecord = await saveRecord("epochs", {
        ...epochRecord,
        screenshotId: screenshot?.id || "",
        screenshotUrl: screenshot?.screenshotUrl || "",
        steps
      });
      await completeEpochAutomation(state, epochRecord, {
        lastScreenshotUrl: screenshot?.screenshotUrl || ""
      });
      return epochRecord;
    }

    const distributionPayload = {
      ...epochPayload,
      payload: {
        ...epochPayload.payload,
        rewardPoolWbtc
      }
    };
    const snapshot = await runLaunchStep(steps, "create-holder-snapshot", () => createHolderSnapshot(distributionPayload));
    const manifestPayload = {
      ...distributionPayload,
      payload: {
        ...distributionPayload.payload,
        snapshotId: snapshot.snapshotId
      }
    };
    const simulation = await runLaunchStep(steps, "simulate-distribution", () => simulateDistribution(manifestPayload));
    if (simulation.payableCount <= 0) {
      epochRecord = await saveRecord("epochs", {
        ...epochRecord,
        status: "skipped_no_payable_recipients",
        rewardPoolWbtc,
        snapshotId: snapshot.snapshotId,
        payableCount: 0,
        steps,
        message: "Epoch completed without distribution because no holders cleared the payout threshold."
      });
      const screenshot = await runLaunchStep(steps, "capture-dashboard-screenshot", () => captureEpochScreenshot(epochRecord), { optional: true });
      epochRecord = await saveRecord("epochs", {
        ...epochRecord,
        screenshotId: screenshot?.id || "",
        screenshotUrl: screenshot?.screenshotUrl || "",
        steps
      });
      await completeEpochAutomation(state, epochRecord, {
        lastScreenshotUrl: screenshot?.screenshotUrl || ""
      });
      return epochRecord;
    }

    const manifest = await runLaunchStep(steps, "finalize-manifest", () => finalizeManifest(manifestPayload));

    // Loop every batch so all eligible holders receive their NVDAx — not just batch 0.
    // simulation.batchCount reflects the full payable recipient count divided by batchSize.
    const totalBatches = Math.max(1, simulation.batchCount || 1);
    let lastBatch = null;
    let lastDistribution = null;
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchPayload = {
        ...distributionPayload,
        payload: {
          ...distributionPayload.payload,
          manifestId: manifest.manifestId,
          batchIndex
        }
      };
      const batch = await runLaunchStep(
        steps,
        `generate-distribution-batch-${batchIndex}`,
        () => generateDistributionBatch(batchPayload)
      );
      if (!batch?.batchId) break;
      lastBatch = batch;
      const distribution = await runLaunchStep(
        steps,
        `distribute-wbtc-${batchIndex}`,
        () =>
          distributeWbtc({
            ...distributionPayload,
            payload: {
              ...distributionPayload.payload,
              batchId: batch.batchId
            }
          })
      );
      if (distribution) lastDistribution = distribution;
    }

    epochRecord = await saveRecord("epochs", {
      ...epochRecord,
      status: lastDistribution?.status || "completed",
      rewardPoolWbtc,
      snapshotId: snapshot.snapshotId,
      manifestId: manifest.manifestId,
      batchId: lastBatch?.batchId || "",
      signature: lastDistribution?.signature || "",
      payableCount: simulation.payableCount,
      batchCount: simulation.batchCount,
      steps,
      message: "Epoch completed through creator-fee claim, NVDAx buy, holder snapshot, and NVDAx distribution."
    });
    const screenshot = await runLaunchStep(steps, "capture-dashboard-screenshot", () => captureEpochScreenshot(epochRecord), { optional: true });
    epochRecord = await saveRecord("epochs", {
      ...epochRecord,
      screenshotId: screenshot?.id || "",
      screenshotUrl: screenshot?.screenshotUrl || "",
      steps
    });
    await completeEpochAutomation(state, epochRecord, {
      lastScreenshotUrl: screenshot?.screenshotUrl || ""
    });
    return epochRecord;
  } catch (error) {
    steps.push(stepError("epoch-runner", error));
    epochRecord = await saveRecord("epochs", {
      ...epochRecord,
      status: "failed",
      error: error.message || String(error),
      steps
    });
    await saveEpochAutomation({
      ...state,
      active: true,
      status: "blocked",
      runningEpochIndex: null,
      runningStartedAt: "",
      lastError: error.message || String(error)
    });
    throw error;
  }
}

async function runDueEpochAction(payload = {}) {
  const body = payload.payload || {};
  return await runScheduledEpoch({
    force: body.force === true,
    source: body.source || "admin",
    payload: body
  });
}

async function pauseEpochAutomation() {
  const state = await readEpochAutomation();
  const saved = await saveEpochAutomation({
    ...(state || {}),
    active: false,
    status: "paused",
    pausedAt: nowIso()
  });
  return automationPublicState(saved);
}

function launchPayloadWithRewardPool(payload, wbtcVault) {
  const body = payload.payload || {};
  const rewardPoolWbtc = Number(body.rewardPoolWbtc ?? body.rewardPool ?? wbtcVault?.balance ?? 0);
  return {
    ...payload,
    payload: {
      ...body,
      rewardPoolWbtc
    }
  };
}

async function officialLiveGo(payload = {}) {
  const dryRun = payload.dryRun !== false;
  const steps = [];
  const startedAt = new Date().toISOString();

  const status = await runLaunchStep(steps, "validate-config", () => validateConfig());
  const config = status.publicConfig || publicConfig();
  const missing = liveAutomationMissing(config);
  if (missing.length) {
    return {
      configured: false,
      dryRun,
      startedAt,
      status: "blocked",
      missing,
      steps,
      message: `Launch is blocked until ${missing.join(", ")} is configured.`
    };
  }

  await runLaunchStep(steps, "refresh-fee-receipts", () => refreshFeeReceipts(), { optional: true });
  await runLaunchStep(steps, "check-wbtc-vault", () => checkWbtcVault(), { optional: true });

  if (dryRun) {
    await runLaunchStep(steps, "refresh-holder-list", () => refreshHolderList(payload), { optional: true });
    return {
      configured: true,
      dryRun: true,
      startedAt,
      status: "ready",
      steps,
      message: "Dry-run start path is ready. Switch off Dry run and enable Confirm live to arm automated epochs."
    };
  }

  const automation = await runLaunchStep(steps, "arm-epoch-automation", () =>
    saveEpochAutomation({
      active: true,
      status: "armed",
      startedAt,
      lastCompletedEpochIndex: null,
      lastCompletedAt: "",
      nextEpochIndex: 0,
      lastEpochId: "",
      lastError: ""
    })
  );

  return {
    configured: true,
    dryRun: false,
    startedAt,
    status: "armed",
    automation: automationPublicState(automation),
    steps,
    message: "Official Live GO armed automation only. Cron will run claim, NVDAx buy, holder snapshot, manifest, batch, and distribution when epoch 1 is due."
  };
}

async function archiveEpochAction(payload = {}) {
  const body = payload.payload || {};
  const id = body.epochId || body.id || "";
  const index = body.epochIndex;

  if (!id && index === undefined) {
    throw new Error("Pass epochId (UUID) or epochIndex (number) to archive.");
  }

  let epoch;
  if (id) {
    epoch = await rewardsStore.query("select * from reward_epochs where id = $1 limit 1", [id]).then((r) => r.rows[0]);
  } else {
    epoch = await rewardsStore.query("select * from reward_epochs where epoch_index = $1 limit 1", [Number(index)]).then((r) => r.rows[0]);
  }

  if (!epoch) {
    throw new Error(`Epoch not found for ${id ? "id=" + id : "index=" + index}.`);
  }

  const updated = await rewardsStore.archiveEpoch(epoch.id);
  return {
    archived: true,
    epochId: updated.id,
    epochIndex: updated.epoch_index,
    status: updated.status
  };
}

async function deleteEpochAction(payload = {}) {
  const body = payload.payload || {};
  const id = body.epochId || body.id || "";
  const index = body.epochIndex;

  if (!id && index === undefined) {
    throw new Error("Pass epochId (UUID) or epochIndex (number) to delete.");
  }

  let epoch;
  if (id) {
    epoch = await rewardsStore.query("select * from reward_epochs where id = $1 limit 1", [id]).then((r) => r.rows[0]);
  } else {
    epoch = await rewardsStore.query("select * from reward_epochs where epoch_index = $1 limit 1", [Number(index)]).then((r) => r.rows[0]);
  }

  if (!epoch) {
    throw new Error(`Epoch not found for ${id ? "id=" + id : "index=" + index}.`);
  }

  await rewardsStore.deleteEpochAndData(epoch.id);
  return {
    deleted: true,
    epochId: epoch.id,
    epochIndex: epoch.epoch_index,
    message: "Epoch and all linked holders, batches, and receipts removed."
  };
}

async function resetTestDataAction(payload = {}) {
  const body = payload.payload || {};
  if (body.confirm !== true) {
    throw new Error("This permanently deletes every epoch and all data. Pass { confirm: true } to proceed.");
  }

  const epochs = await rewardsStore.listEpochs();
  let deletedCount = 0;
  for (const epoch of epochs) {
    await rewardsStore.deleteEpochAndData(epoch.id);
    deletedCount++;
  }

  return {
    reset: true,
    deletedCount,
    message: `Deleted ${deletedCount} epoch(s) and all linked holders, batches, and receipts.`
  };
}

async function goLiveResetAction(payload = {}) {
  const body = payload.payload || {};
  if (body.confirm !== true) {
    throw new Error("This archives and deletes ALL epochs, holders, batches, and receipts, then creates a fresh epoch 0. Pass { confirm: true } to proceed.");
  }

  const epochs = await rewardsStore.listEpochs();
  let archivedCount = 0;
  let deletedCount = 0;

  // Step 1: archive all existing epochs
  for (const epoch of epochs) {
    try {
      await rewardsStore.archiveEpoch(epoch.id);
      archivedCount++;
    } catch {
      // best effort
    }
  }

  // Step 2: delete all epochs and cascaded data
  for (const epoch of epochs) {
    try {
      await rewardsStore.deleteEpochAndData(epoch.id);
      deletedCount++;
    } catch {
      // best effort
    }
  }

  // Step 3: create fresh epoch 0 (dynamic require to avoid circular dep)
  const { epochTick } = require("./rewards/epochs");
  const tick = await epochTick({ source: "go-live-reset" });

  const fresh = await rewardsStore.currentEpoch();
  return {
    reset: true,
    archivedCount,
    deletedCount,
    tick,
    freshEpoch: fresh
      ? {
          id: fresh.id,
          epochIndex: fresh.epochIndex,
          status: fresh.status,
          startsAt: fresh.startsAt,
          endsAt: fresh.endsAt,
          tokenMint: fresh.tokenMint
        }
      : null,
    message: `Archived ${archivedCount} and deleted ${deletedCount} epoch(s). Fresh epoch 0 created. Ready for production.`
  };
}

module.exports = {
  adminStatus,
  adminAuthError,
  isAdminAuthorized,
  runAdminAction,
  runScheduledEpoch
};
