const fs = require("node:fs");
const bs58 = require("bs58");
const { Keypair, VersionedTransaction } = require("@solana/web3.js");
const { createSolanaConnection } = require("./solana-rpc");

const DEFAULT_PUMPPORTAL_LOCAL_API_URL = "https://pumpportal.fun/api/trade-local";

function decodeBase58(value) {
  const decoder = bs58.decode || bs58.default?.decode;
  if (!decoder) throw new Error("bs58 decoder is unavailable.");
  return decoder(value);
}

function readCreatorKeypair() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) throw new Error("Set WALLET_PRIVATE_KEY for live creator-fee claims.");
  return Keypair.fromSecretKey(decodeBase58(key));
}

function creatorPublicKey() {
  if (process.env.WALLET) return process.env.WALLET;
  return readCreatorKeypair().publicKey.toBase58();
}

async function buildCreatorFeeClaimTransaction({ payload = {}, publicKey }) {
  const body = payload.payload || {};
  const claimPublicKey = body.publicKey || body.creatorPublicKey || publicKey || creatorPublicKey();
  if (!claimPublicKey) {
    throw new Error("Set CREATOR_PUBLIC_KEY or CREATOR_KEYPAIR_PATH before claiming creator fees.");
  }

  const requestBody = {
    publicKey: claimPublicKey,
    action: "collectCreatorFee",
    priorityFee: Number(body.priorityFee || process.env.CREATOR_FEE_PRIORITY_FEE_SOL || 0.000001)
  };
  if (body.pool || process.env.CREATOR_FEE_POOL) requestBody.pool = body.pool || process.env.CREATOR_FEE_POOL;
  if (body.mint || process.env.TOKEN_MINT) requestBody.mint = body.mint || process.env.TOKEN_MINT;

  const apiUrl = process.env.PUMPPORTAL_LOCAL_API_URL || DEFAULT_PUMPPORTAL_LOCAL_API_URL;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    const text = Buffer.from(bytes).toString("utf8");
    throw new Error(text || `PumpPortal creator-fee transaction build failed with ${response.status}.`);
  }

  const tx = VersionedTransaction.deserialize(bytes);
  return {
    apiUrl,
    publicKey: claimPublicKey,
    requestBody,
    transaction: tx,
    transactionBase64: Buffer.from(bytes).toString("base64")
  };
}

async function simulateCreatorFeeClaim(payload = {}) {
  const built = await buildCreatorFeeClaimTransaction({ payload });
  return {
    provider: "pumpportal",
    status: "built",
    publicKey: built.publicKey,
    apiUrl: built.apiUrl,
    request: built.requestBody,
    unsignedTransactionBytes: Buffer.from(built.transaction.serialize()).length,
    message: "Creator-fee claim transaction built. Live claim will sign and submit it with CREATOR_KEYPAIR_PATH."
  };
}

async function claimCreatorFees(payload = {}) {
  const dryRun = payload.dryRun === true;
  const keypair = dryRun ? null : readCreatorKeypair();
  const built = await buildCreatorFeeClaimTransaction({
    payload,
    publicKey: keypair?.publicKey.toBase58()
  });

  if (dryRun) {
    return {
      provider: "pumpportal",
      dryRun: true,
      status: "built",
      publicKey: built.publicKey,
      apiUrl: built.apiUrl,
      request: built.requestBody,
      unsignedTransactionBase64: built.transactionBase64,
      message: "Dry run built the creator-fee claim transaction. Disable Dry run to sign and send."
    };
  }

  built.transaction.sign([keypair]);
  const connection = await createSolanaConnection(process.env, { commitment: "confirmed" });
  const signature = await connection.sendTransaction(built.transaction, {
    maxRetries: Number(payload.payload?.maxRetries || 3),
    skipPreflight: payload.payload?.skipPreflight === true
  });
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    },
    "confirmed"
  );

  return {
    provider: "pumpportal",
    dryRun: false,
    status: "confirmed",
    signature,
    publicKey: keypair.publicKey.toBase58(),
    apiUrl: built.apiUrl,
    request: built.requestBody
  };
}

module.exports = {
  claimCreatorFees,
  creatorPublicKey,
  simulateCreatorFeeClaim
};
