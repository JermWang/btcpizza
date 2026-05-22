const { Connection } = require("@solana/web3.js");

const DEFAULT_PUBLIC_SOLANA_RPC_URL = "https://api.mainnet.solana.com";
const RPC_PROBE_ADDRESS = "11111111111111111111111111111111";

let cachedRpcSelection = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRpcUrls(value = "") {
  return String(value)
    .split(/[,\n\r\t ]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function solanaRpcUrls(env = process.env) {
  const urls = [];
  pushUnique(urls, env.SOLANA_RPC_URL);
  pushUnique(urls, env.HELIUS_RPC_URL);
  if (env.HELIUS_API_KEY) pushUnique(urls, `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`);

  const fallbackUrls = parseRpcUrls(env.SOLANA_RPC_FALLBACK_URLS);
  if (fallbackUrls.length) {
    fallbackUrls.forEach((url) => pushUnique(urls, url));
  } else if (env.SOLANA_RPC_DISABLE_DEFAULT_FALLBACK !== "true") {
    pushUnique(urls, DEFAULT_PUBLIC_SOLANA_RPC_URL);
  }

  return urls;
}

function hasSolanaRpc(env = process.env) {
  return solanaRpcUrls(env).length > 0;
}

function retryDelayMs(response, retryBaseMs, attempt) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return retryBaseMs * 2 ** attempt;
}

function normalizedRequestOrigin(value = "") {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function rpcOriginHeaders(env = process.env) {
  const origin = normalizedRequestOrigin(
    env.PUBLIC_SITE_URL ||
      env.PUBLIC_APP_URL ||
      env.SITE_URL ||
      env.NEXT_PUBLIC_SITE_URL ||
      env.VERCEL_PROJECT_PRODUCTION_URL ||
      env.VERCEL_URL
  );
  if (!origin) return {};
  return {
    origin,
    referer: `${origin}/`
  };
}

function shouldFailoverHttp(status) {
  return status === 401 || status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function shouldRetryHttp(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function shouldRetryRpcError(code) {
  return code === 429 || code === -32005 || code === -32004 || code === -32603;
}

function abortSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function orderUrlsFromSelection(urls, selectedUrl) {
  const selectedIndex = urls.indexOf(selectedUrl);
  if (selectedIndex < 0) return urls;
  return [selectedUrl, ...urls.slice(selectedIndex + 1).filter((url) => url !== selectedUrl)];
}

async function rpcRequestToUrl(url, method, params, env, options = {}) {
  const timeoutMs = Number(options.timeoutMs || env.SOLANA_RPC_TIMEOUT_MS || 12_000);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...rpcOriginHeaders(env)
    },
    signal: abortSignal(timeoutMs),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "bitcoin-pizza-strategy",
      method,
      params
    })
  });

  if (!response.ok) {
    const error = new Error(`RPC request failed: ${response.status}`);
    error.status = response.status;
    error.retryable = shouldRetryHttp(response.status);
    error.failover = shouldFailoverHttp(response.status);
    error.retryAfterMs = retryDelayMs(response, Number(env.SOLANA_RPC_RETRY_BASE_MS || 650), 0);
    throw error;
  }

  const body = await response.json();
  if (body.error) {
    const error = new Error(body.error.message || "RPC returned an error");
    error.code = body.error.code;
    error.retryable = shouldRetryRpcError(body.error.code);
    error.failover = shouldRetryRpcError(body.error.code);
    throw error;
  }

  return body.result;
}

async function rpcRequest(method, params, env = process.env, options = {}) {
  const urls = solanaRpcUrls(env);
  if (!urls.length) {
    throw new Error("SOLANA_RPC_URL, HELIUS_RPC_URL, or SOLANA_RPC_FALLBACK_URLS is not configured");
  }

  const key = urls.join("|");
  let orderedUrls = urls;
  if (cachedRpcSelection?.key === key && cachedRpcSelection.expiresAt > Date.now()) {
    orderedUrls = orderUrlsFromSelection(urls, cachedRpcSelection.url);
  } else {
    try {
      const selectedUrl = await selectSolanaRpcUrl(env);
      orderedUrls = orderUrlsFromSelection(urls, selectedUrl);
    } catch {
      orderedUrls = urls;
    }
  }

  const retryCount = Math.max(0, Number(env.SOLANA_RPC_RETRY_COUNT || 2));
  const retryBaseMs = Math.max(100, Number(env.SOLANA_RPC_RETRY_BASE_MS || 650));
  let lastError;

  for (let urlIndex = 0; urlIndex < orderedUrls.length; urlIndex += 1) {
    const url = orderedUrls[urlIndex];
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const result = await rpcRequestToUrl(url, method, params, env, options);
        cachedRpcSelection = {
          key,
          url,
          expiresAt: Date.now() + Number(env.SOLANA_RPC_SELECTION_TTL_MS || 60_000)
        };
        return result;
      } catch (error) {
        lastError = error;
        const canTryNextUrl = urlIndex < orderedUrls.length - 1 && error.failover !== false;
        if (canTryNextUrl && (error.status === 401 || error.status === 403 || error.status === 429)) break;
        if (!error.retryable || attempt >= retryCount) break;
        await sleep(error.retryAfterMs || retryBaseMs * 2 ** attempt);
      }
    }
  }

  throw lastError || new Error("RPC request failed");
}

async function selectSolanaRpcUrl(env = process.env) {
  const urls = solanaRpcUrls(env);
  if (!urls.length) {
    throw new Error("SOLANA_RPC_URL, HELIUS_RPC_URL, or SOLANA_RPC_FALLBACK_URLS is not configured");
  }

  const key = urls.join("|");
  if (cachedRpcSelection?.key === key && cachedRpcSelection.expiresAt > Date.now()) {
    return cachedRpcSelection.url;
  }

  let lastError;
  for (const url of urls) {
    try {
      const probeAddress = env.SOLANA_RPC_PROBE_ADDRESS || env.PUBLIC_FEE_WALLET || env.DEV_CREATOR_WALLET || RPC_PROBE_ADDRESS;
      await rpcRequestToUrl(url, "getBalance", [probeAddress], env, {
        timeoutMs: Number(env.SOLANA_RPC_PROBE_TIMEOUT_MS || 8_000)
      });
      cachedRpcSelection = {
        key,
        url,
        expiresAt: Date.now() + Number(env.SOLANA_RPC_SELECTION_TTL_MS || 60_000)
      };
      return url;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No healthy Solana RPC endpoint is available");
}

async function createSolanaConnection(env = process.env, options = {}) {
  const url = await selectSolanaRpcUrl(env);
  return new Connection(url, options.commitment || "confirmed");
}

module.exports = {
  DEFAULT_PUBLIC_SOLANA_RPC_URL,
  createSolanaConnection,
  hasSolanaRpc,
  parseRpcUrls,
  rpcOriginHeaders,
  rpcRequest,
  selectSolanaRpcUrl,
  solanaRpcUrls
};
