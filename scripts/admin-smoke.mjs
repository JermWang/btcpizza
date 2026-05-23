import { readFile } from "node:fs/promises";

async function loadEnv(file = ".env") {
  const env = { ...process.env };
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // Local .env is optional, but admin smoke needs the values when present.
  }
  return env;
}

function short(value = "") {
  if (!value || value.length < 12) return value || "";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  if (!response.ok) {
    const message = body.error || body.message || text || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function adminAction({ baseUrl, adminSecret, action, payload = {}, confirm = false }) {
  const body = {
    action,
    dryRun: true,
    confirm,
    payload
  };
  return await requestJson(`${baseUrl}/api/admin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-password": adminSecret
    },
    body: JSON.stringify(body)
  });
}

function summarizeResult(result) {
  const detail = result?.result || result || {};
  return (
    detail.status ||
    detail.provider ||
    detail.message ||
    (detail.configured === true ? "configured" : "") ||
    detail.mode ||
    "ok"
  );
}

async function runCheck(check) {
  if (check.optional) {
    return {
      name: check.name,
      ok: true,
      status: "SKIP",
      detail: check.skipReason || "Optional check is not configured."
    };
  }

  try {
    const result = await check.run();
    return {
      name: check.name,
      ok: true,
      status: "PASS",
      detail: check.detail ? check.detail(result) : summarizeResult(result)
    };
  } catch (error) {
    return {
      name: check.name,
      ok: false,
      status: "FAIL",
      detail: error.message
    };
  }
}

const env = await loadEnv();
const port = env.PORT || "4199";
const baseUrl = process.env.ADMIN_SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
const adminSecret = env.ADMIN_API_TOKEN || env.ADMIN_PASSWORD;

if (!adminSecret) {
  console.error("ADMIN_PASSWORD or ADMIN_API_TOKEN is required for smoke testing.");
  process.exit(1);
}

const tinyBuyPayload = {
  inputAmountSol: Number(process.env.ADMIN_SMOKE_BUY_SOL || 0.001),
  slippageBps: Number(env.MAX_SLIPPAGE_BPS || 100)
};

const checks = [
  {
    name: "Public config",
    run: async () => await requestJson(`${baseUrl}/api/config`),
    detail: (config) =>
      `fee=${short(config.feeWallet)} distributor=${short(config.distributorWallet)} token=${
        config.tokenMint ? short(config.tokenMint) : "missing"
      }`
  },
  {
    name: "Public operations summary",
    run: async () => await requestJson(`${baseUrl}/api/operations`),
    detail: (operations) =>
      `storage=${operations.storage?.backend || "n/a"} automation=${operations.automation?.status || "unknown"} latestSnapshot=${
        operations.latestSnapshot?.label || "none"
      }`
  },
  {
    name: "Admin status",
    run: async () =>
      await requestJson(`${baseUrl}/api/admin`, {
        headers: { "x-admin-password": adminSecret }
      }),
    detail: (status) => `${status.summary.configuredActions}/${status.summary.totalActions} actions configured`
  },
  {
    name: "Official Live GO wiring",
    run: async () => {
      const status = await requestJson(`${baseUrl}/api/admin`, {
        headers: { "x-admin-password": adminSecret }
      });
      const action = status.actions.find((item) => item.id === "official-live-go");
      if (!action) throw new Error("official-live-go action is missing");
      if (!action.dangerous) throw new Error("official-live-go must remain live-gated");
      return action;
    },
    detail: (action) => `${action.mode}${action.configured ? " configured" : " missing config"}`
  },
  {
    name: "Validate config",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "validate-config" })
  },
  {
    name: "Fee wallet SOL/WSOL read",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "refresh-fee-receipts" }),
    detail: (result) => {
      const data = result.result;
      return `SOL=${data.solBalance} WSOL=${data.wsolBalance} receipts=${data.receiptCount}`;
    }
  },
  {
    name: "NVDAx vault read",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "check-wbtc-vault" }),
    detail: (result) => `NVDAx=${result.result.balance} accounts=${result.result.accountCount}`
  },
  {
    name: "Jupiter NVDAx quote",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "quote-wbtc-buy", payload: tinyBuyPayload }),
    detail: (result) => `in=${result.result.inAmount} out=${result.result.outAmount}`
  },
  {
    name: "Jupiter unsigned swap build",
    run: async () =>
      await adminAction({
        baseUrl,
        adminSecret,
        action: "execute-wbtc-buy",
        payload: tinyBuyPayload,
        confirm: true
      }),
    detail: (result) =>
      `tx=${result.result.swapTransaction ? "built" : "missing"} lastValidBlockHeight=${
        result.result.lastValidBlockHeight || "n/a"
      }`
  },
  {
    name: "PumpPortal fee-claim build",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "simulate-creator-fee-claim" })
  },
  {
    name: "Dry-run creator-fee claim",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "claim-creator-fees", confirm: true })
  },
  {
    name: "Holder snapshot from token mint",
    optional: !env.TOKEN_MINT,
    skipReason: "TOKEN_MINT is not set.",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "refresh-holder-list" }),
    detail: (result) => `holders=${result.result.totalEligible} fetched=${result.result.totalFetched}`
  },
  {
    name: "Create holder snapshot",
    optional: !env.TOKEN_MINT,
    skipReason: "TOKEN_MINT is not set.",
    run: async () => await adminAction({ baseUrl, adminSecret, action: "create-holder-snapshot" }),
    detail: (result) => `snapshot=${result.result.snapshotId} holders=${result.result.totalEligible}`
  },
  {
    name: "Simulate distribution math",
    optional: !env.TOKEN_MINT,
    skipReason: "TOKEN_MINT is not set.",
    run: async () =>
      await adminAction({
        baseUrl,
        adminSecret,
        action: "simulate-distribution",
        payload: {
          rewardPool: Number(process.env.ADMIN_SMOKE_REWARD_WBTC || 0.000001),
          minPayout: Number(process.env.ADMIN_SMOKE_MIN_PAYOUT_WBTC || 0)
        }
      }),
    detail: (result) => `payable=${result.result.payableCount} recipients=${result.result.recipientCount}`
  }
];

console.log(`Admin smoke target: ${baseUrl}`);
console.log(`Wallet: ${short(env.WALLET || "")}`);
console.log(`Token mint: ${env.TOKEN_MINT ? short(env.TOKEN_MINT) : "not set yet"}`);

const results = [];
for (const check of checks) {
  const result = await runCheck(check);
  results.push(result);
  console.log(`${result.status.padEnd(4)} ${result.name} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.error(`Smoke failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("Smoke passed.");
