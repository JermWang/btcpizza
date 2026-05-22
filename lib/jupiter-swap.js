const fs = require("node:fs");
const bs58 = require("bs58");
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_JUPITER_API_BASE_URL = "https://api.jup.ag/swap/v1";

function decodeBase58(value) {
  const decoder = bs58.decode || bs58.default?.decode;
  if (!decoder) throw new Error("bs58 decoder is unavailable.");
  return decoder(value);
}

function readSwapKeypair() {
  if (process.env.JUPITER_SWAP_PRIVATE_KEY_BASE58) {
    return Keypair.fromSecretKey(decodeBase58(process.env.JUPITER_SWAP_PRIVATE_KEY_BASE58));
  }

  const keypairPath = process.env.JUPITER_SWAP_KEYPAIR_PATH || process.env.DISTRIBUTOR_KEYPAIR_PATH || process.env.CREATOR_KEYPAIR_PATH;
  if (!keypairPath) {
    throw new Error("Set JUPITER_SWAP_PRIVATE_KEY_BASE58, JUPITER_SWAP_KEYPAIR_PATH, DISTRIBUTOR_KEYPAIR_PATH, or CREATOR_KEYPAIR_PATH for live WBTC buys.");
  }

  const raw = fs.readFileSync(keypairPath, "utf8").trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return Keypair.fromSecretKey(decodeBase58(raw));
}

function jupiterBaseUrl() {
  return (process.env.JUPITER_API_BASE_URL || DEFAULT_JUPITER_API_BASE_URL).replace(/\/$/, "");
}

function jupiterHeaders() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    ...(process.env.JUPITER_API_KEY ? { "x-api-key": process.env.JUPITER_API_KEY } : {})
  };
}

function rawSolAmount(payload = {}) {
  const body = payload.payload || payload || {};
  if (body.inputAmountLamports || body.amountLamports || body.amount) {
    return String(body.inputAmountLamports || body.amountLamports || body.amount);
  }
  const solAmount = Number(body.inputAmountSol || body.buyAmountSol || process.env.MAX_CYCLE_SPEND_UI_AMOUNT || 0);
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    throw new Error("Set payload.inputAmountLamports, payload.inputAmountSol, or MAX_CYCLE_SPEND_UI_AMOUNT before quoting WBTC.");
  }
  return String(Math.floor(solAmount * 1_000_000_000));
}

function inputMint(payload = {}) {
  const body = payload.payload || payload || {};
  return body.inputMint || process.env.JUPITER_INPUT_MINT || SOL_MINT;
}

function shouldWrapAndUnwrapSol(payload = {}) {
  const body = payload.payload || payload || {};
  if (body.wrapAndUnwrapSol !== undefined) return body.wrapAndUnwrapSol;
  if (body.inputSource === "wsol" || process.env.JUPITER_INPUT_SOURCE === "wsol") return false;
  if (process.env.JUPITER_WRAP_AND_UNWRAP_SOL !== undefined) return process.env.JUPITER_WRAP_AND_UNWRAP_SOL !== "false";
  return true;
}

function routeSummary(quote) {
  return (quote.routePlan || []).map((route) => ({
    label: route.swapInfo?.label || "Unknown route",
    percent: route.percent,
    inputMint: route.swapInfo?.inputMint,
    outputMint: route.swapInfo?.outputMint,
    inAmount: route.swapInfo?.inAmount,
    outAmount: route.swapInfo?.outAmount,
    feeAmount: route.swapInfo?.feeAmount,
    feeMint: route.swapInfo?.feeMint
  }));
}

async function jupiterQuote({ outputMint, payload = {} }) {
  if (!outputMint) throw new Error("PUBLIC_WBTC_MINT is required for Jupiter quotes.");
  const body = payload.payload || {};
  const params = new URLSearchParams({
    inputMint: inputMint(payload),
    outputMint,
    amount: rawSolAmount(payload),
    slippageBps: String(body.slippageBps || process.env.MAX_SLIPPAGE_BPS || 100),
    restrictIntermediateTokens: String(body.restrictIntermediateTokens ?? true),
    onlyDirectRoutes: String(body.onlyDirectRoutes ?? false)
  });
  const response = await fetch(`${jupiterBaseUrl()}/quote?${params}`, {
    headers: jupiterHeaders()
  });
  const quote = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(quote.error || quote.message || `Jupiter quote failed with ${response.status}.`);
  }
  return {
    provider: "jupiter",
    apiBaseUrl: jupiterBaseUrl(),
    quote,
    routeSummary: routeSummary(quote),
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    otherAmountThreshold: quote.otherAmountThreshold,
    priceImpactPct: quote.priceImpactPct,
    slippageBps: quote.slippageBps
  };
}

async function jupiterSwapTransaction({ outputMint, userPublicKey, payload = {} }) {
  if (!userPublicKey) {
    throw new Error("Set JUPITER_SWAP_USER_PUBLIC_KEY or payload.userPublicKey so Jupiter can build the unsigned swap transaction.");
  }
  const dryRun = payload.dryRun !== false;
  const quoteResult = await jupiterQuote({ outputMint, payload });
  const body = payload.payload || {};
  const response = await fetch(`${jupiterBaseUrl()}/swap`, {
    method: "POST",
    headers: jupiterHeaders(),
    body: JSON.stringify({
      userPublicKey,
      quoteResponse: quoteResult.quote,
      wrapAndUnwrapSol: shouldWrapAndUnwrapSol(payload),
      dynamicComputeUnitLimit: body.dynamicComputeUnitLimit ?? true,
      prioritizationFeeLamports: body.prioritizationFeeLamports || "auto"
    })
  });
  const swap = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(swap.error || swap.message || `Jupiter swap build failed with ${response.status}.`);
  }

  let submitted = null;
  if (!dryRun) {
    const signer = readSwapKeypair();
    const signerPublicKey = signer.publicKey.toBase58();
    if (signerPublicKey !== userPublicKey) {
      throw new Error(`Jupiter swap signer ${signerPublicKey} does not match userPublicKey ${userPublicKey}.`);
    }
    if (!process.env.SOLANA_RPC_URL) {
      throw new Error("SOLANA_RPC_URL is required to submit live Jupiter swaps.");
    }

    const transaction = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
    transaction.sign([signer]);
    const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: Number(process.env.JUPITER_SEND_MAX_RETRIES || 3),
      skipPreflight: process.env.JUPITER_SKIP_PREFLIGHT === "true"
    });
    await connection.confirmTransaction(
      {
        signature,
        blockhash: transaction.message.recentBlockhash,
        lastValidBlockHeight: swap.lastValidBlockHeight
      },
      "confirmed"
    );
    submitted = {
      signature,
      signer: signerPublicKey,
      signedTransactionBytes: transaction.serialize().length
    };
  }

  return {
    provider: "jupiter",
    dryRun,
    apiBaseUrl: jupiterBaseUrl(),
    userPublicKey,
    quote: quoteResult,
    swapTransaction: swap.swapTransaction,
    lastValidBlockHeight: swap.lastValidBlockHeight,
    prioritizationFeeLamports: swap.prioritizationFeeLamports,
    computeUnitLimit: swap.computeUnitLimit,
    submitted,
    signature: submitted?.signature || "",
    message: submitted
      ? "Jupiter swap signed and submitted with the configured treasury signer."
      : "Unsigned Jupiter swap transaction built. Set dryRun=false and confirm=true to sign and submit it."
  };
}

module.exports = {
  SOL_MINT,
  jupiterQuote,
  jupiterSwapTransaction
};
