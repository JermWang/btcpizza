import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const envRoot = dirname(root);
const port = Number(process.env.PORT || 4173);
const env = await loadEnv();

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

function publicConfig() {
  return {
    cluster: env.SOLANA_CLUSTER || "mainnet-beta",
    rpcConfigured: Boolean(env.SOLANA_RPC_URL),
    feeWallet: env.PUBLIC_FEE_WALLET || "",
    tokenMint: env.PUBLIC_TOKEN_MINT || "",
    wbtcMint: env.PUBLIC_WBTC_MINT || "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
    distributorWallet: env.PUBLIC_DISTRIBUTOR_WALLET || "",
    holderIndexerUrlConfigured: Boolean(env.HOLDER_INDEXER_API_URL),
    solscanBaseUrl: env.PUBLIC_SOLSCAN_BASE_URL || "https://solscan.io",
    coingeckoApiUrl: env.PUBLIC_COINGECKO_API_URL || "https://api.coingecko.com/api/v3"
  };
}

async function rpc(method, params) {
  if (!env.SOLANA_RPC_URL) {
    throw new Error("SOLANA_RPC_URL is not configured");
  }

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
    throw new Error(`RPC request failed: ${result.status}`);
  }

  const body = await result.json();
  if (body.error) {
    throw new Error(body.error.message || "RPC returned an error");
  }
  return body.result;
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

  return {
    configured: true,
    solBalance: lamports.value / 1_000_000_000,
    receipts: signatures.map((item) => ({
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime,
      status: item.err ? "failed" : "confirmed"
    }))
  };
}

async function tokenBalance(owner, mint) {
  if (!owner || !mint) {
    return { configured: false, balance: null };
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

  return { configured: true, balance };
}

async function holderSnapshot(wallet) {
  if (!env.HOLDER_INDEXER_API_URL) {
    return {
      configured: false,
      reason: "HOLDER_INDEXER_API_URL is not configured",
      wallet: wallet || "",
      current: null,
      holders: []
    };
  }

  const url = new URL(env.HOLDER_INDEXER_API_URL);
  if (wallet) url.searchParams.set("wallet", wallet);
  const result = await fetch(url, { headers: { accept: "application/json" } });
  if (!result.ok) throw new Error(`Holder indexer failed: ${result.status}`);
  return await result.json();
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

  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
