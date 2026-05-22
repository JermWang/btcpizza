import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { adminAuthError, adminStatus, isAdminAuthorized, runAdminAction } = require("../lib/admin-control.js");
const { buildDistributionPolicy, currentDistributionEpoch, distributionPreview } = require("../lib/distribution-policy.js");
const { fetchRpcHolderSnapshot, parseWalletList, toDashboardSnapshot } = require("../lib/rpc-holders.js");
const { tokenBalanceForOwner } = require("../lib/token-utils.js");
const root = dirname(fileURLToPath(import.meta.url));
const envRoot = dirname(root);
const env = await loadEnv();
Object.assign(process.env, env);
const port = Number(process.env.PORT || 4199);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

async function loadEnv() {
  const values = { ...process.env };
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(join(envRoot, file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, raw] = match;
        values[key] = raw.replace(/^["']|["']$/g, "");
      }
    } catch {
      // Optional local env files are expected to be absent in fresh clones.
    }
  }
  return values;
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicConfig() {
  const devCreatorWallet = env.DEV_CREATOR_WALLET || "";
  const distributionPolicy = buildDistributionPolicy(env);
  const distributionEpoch = currentDistributionEpoch(distributionPolicy);
  const distributionSchedule = distributionPreview(distributionPolicy);
  return {
    cluster: env.SOLANA_CLUSTER || "mainnet-beta",
    rpcConfigured: Boolean(env.SOLANA_RPC_URL),
    devCreatorWallet,
    feeWallet: env.PUBLIC_FEE_WALLET || devCreatorWallet,
    contractAddress: env.PUBLIC_CONTRACT_ADDRESS || env.PUBLIC_TOKEN_MINT || "",
    tokenMint: env.PUBLIC_TOKEN_MINT || "",
    wbtcMint: env.PUBLIC_WBTC_MINT || "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
    wsolMint: env.PUBLIC_WSOL_MINT || "So11111111111111111111111111111111111111112",
    distributorWallet: env.PUBLIC_DISTRIBUTOR_WALLET || devCreatorWallet,
    jupiterConfigured: true,
    jupiterApiBaseUrl: env.JUPITER_API_BASE_URL || "https://api.jup.ag/swap/v1",
    jupiterSwapUserPublicKey: env.JUPITER_SWAP_USER_PUBLIC_KEY || devCreatorWallet,
    creatorFeeClaimPublicKey: env.CREATOR_PUBLIC_KEY || devCreatorWallet,
    pumpPortalLocalApiUrl: env.PUMPPORTAL_LOCAL_API_URL || "https://pumpportal.fun/api/trade-local",
    holderIndexerUrlConfigured: Boolean(env.HOLDER_INDEXER_API_URL),
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

async function rpc(method, params) {
  if (!env.SOLANA_RPC_URL) {
    throw new Error("SOLANA_RPC_URL is not configured");
  }

  const retryCount = Number(env.SOLANA_RPC_RETRY_COUNT || 4);
  const retryBaseMs = Number(env.SOLANA_RPC_RETRY_BASE_MS || 650);
  let lastError;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const result = await fetch(env.SOLANA_RPC_URL, {
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
        const retryAfter = Number(result.headers.get("retry-after"));
        const retryable = result.status === 429 || result.status >= 500;
        if (retryable && attempt < retryCount) {
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retryBaseMs * 2 ** attempt;
          await sleep(delay);
          continue;
        }
        const error = new Error(`RPC request failed: ${result.status}`);
        error.retryable = retryable;
        throw error;
      }

      const body = await result.json();
      if (body.error) {
        const retryable = body.error.code === 429 || body.error.code === -32005;
        if (retryable && attempt < retryCount) {
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        const error = new Error(body.error.message || "RPC returned an error");
        error.retryable = retryable;
        throw error;
      }
      return body.result;
    } catch (error) {
      lastError = error;
      if (error?.retryable === false) throw error;
      if (attempt >= retryCount) break;
      await sleep(retryBaseMs * 2 ** attempt);
    }
  }

  throw lastError || new Error("RPC request failed");
}

async function feeReceipts() {
  const config = publicConfig();
  if (!config.feeWallet) {
    return {
      configured: false,
      reason: "PUBLIC_FEE_WALLET is not configured",
      receipts: []
    };
  }

  const signatures = await rpc("getSignaturesForAddress", [
    config.feeWallet,
    { limit: Number(env.FEE_RECEIPT_LIMIT || 10) }
  ]);
  const lamports = await rpc("getBalance", [config.feeWallet]);
  const wsol = await tokenBalanceForOwner({ rpc, owner: config.feeWallet, mint: config.wsolMint });

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

async function tokenBalance(owner, mint) {
  return await tokenBalanceForOwner({ rpc, owner, mint });
}

async function holderSnapshot(wallet) {
  const config = publicConfig();
  const provider = env.HOLDER_SNAPSHOT_PROVIDER || "external";
  const allowRpcFallback = env.ENABLE_RPC_HOLDER_FALLBACK === "true" || provider === "solana-rpc";

  if (provider !== "solana-rpc" && env.HOLDER_INDEXER_API_URL) {
    const url = new URL(env.HOLDER_INDEXER_API_URL);
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
    ...parseWalletList(env.HOLDER_EXCLUDED_WALLETS || ""),
    config.feeWallet,
    config.distributorWallet
  ].filter(Boolean);
  const snapshot = await fetchRpcHolderSnapshot({
    tokenMint: config.tokenMint,
    rpc,
    minBalanceUi: Number(env.HOLDER_SNAPSHOT_MIN_BALANCE || 0),
    excludedWallets
  });

  const roundCap = currentDistributionEpoch(buildDistributionPolicy(env)).holderCap;
  return toDashboardSnapshot(snapshot, wallet || "", roundCap);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/config") {
    json(response, 200, publicConfig());
    return;
  }

  if (url.pathname === "/api/fee-receipts") {
    try {
      json(response, 200, await feeReceipts());
    } catch (error) {
      json(response, 502, { configured: Boolean(env.SOLANA_RPC_URL), error: error.message, receipts: [] });
    }
    return;
  }

  if (url.pathname === "/api/token-balance") {
    try {
      json(response, 200, await tokenBalance(url.searchParams.get("owner"), url.searchParams.get("mint")));
    } catch (error) {
      json(response, 502, { configured: Boolean(env.SOLANA_RPC_URL), error: error.message, balance: null });
    }
    return;
  }

  if (url.pathname === "/api/holders") {
    try {
      json(response, 200, await holderSnapshot(url.searchParams.get("wallet")));
    } catch (error) {
      json(response, 502, { configured: Boolean(env.HOLDER_INDEXER_API_URL), error: error.message, holders: [] });
    }
    return;
  }

  if (url.pathname === "/api/admin") {
    if (!isAdminAuthorized(request.headers)) {
      json(response, 401, { ok: false, error: adminAuthError() });
      return;
    }

    try {
      if (request.method === "GET") {
        json(response, 200, adminStatus());
        return;
      }

      if (request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await runAdminAction(body.action, body);
        json(response, result.ok ? 200 : 502, result);
        return;
      }

      response.setHeader("allow", "GET, POST");
      json(response, 405, { ok: false, error: "Method not allowed." });
    } catch (error) {
      json(response, error.statusCode || 500, { ok: false, error: error.message || "Admin action failed." });
    }
    return;
  }

  const relativePath = url.pathname === "/" ? "index.html" : url.pathname === "/admin" ? "admin.html" : url.pathname.slice(1);
  const filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Design preview running at http://localhost:${port}`);
});
