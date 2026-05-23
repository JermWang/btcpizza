const {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} = require("@solana/web3.js");
const { createSolanaConnection, hasSolanaRpc } = require("./solana-rpc");
const { hasConfiguredKeypair, readConfiguredKeypair } = require("./solana-keypair");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const DISTRIBUTOR_KEYPAIR_CONFIG = {
  base58: ["WALLET_PRIVATE_KEY"],
  file: [],
  label: "NVDAx distribution"
};

function readKeypair() {
  return readConfiguredKeypair(DISTRIBUTOR_KEYPAIR_CONFIG);
}

function associatedTokenAddress(owner, mint, tokenProgramId = TOKEN_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function createAtaIdempotentInstruction({ payer, owner, mint, ata, tokenProgramId = TOKEN_PROGRAM_ID }) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1])
  });
}

function transferCheckedInstruction({ source, mint, destination, owner, amountRaw, decimals, tokenProgramId = TOKEN_PROGRAM_ID }) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amountRaw, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  });
}

function uiAmountToRaw(value, decimals) {
  const text = String(value ?? "0").trim();
  if (!text || text === "0") return 0n;
  const negative = text.startsWith("-");
  if (negative) throw new Error("Distribution rewards cannot be negative.");
  const [wholePart, decimalPart = ""] = text.split(".");
  const whole = BigInt(wholePart || "0") * 10n ** BigInt(decimals);
  const padded = `${decimalPart}${"0".repeat(decimals)}`.slice(0, decimals);
  const fractional = BigInt(padded || "0");
  return whole + fractional;
}

async function tokenDecimals(connection, mint) {
  const supply = await connection.getTokenSupply(mint);
  return supply.value.decimals;
}

function recipientReward(recipient) {
  return recipient.rewardRaw ?? recipient.amountRaw ?? recipient.reward ?? recipient.amount ?? 0;
}

async function distributeWbtcBatch({ batch, config, payload = {} }) {
  if (!batch?.recipients?.length) {
    throw new Error("Prepared batch has no recipients.");
  }
  if (!hasSolanaRpc(process.env)) {
    throw new Error("SOLANA_RPC_URL or SOLANA_RPC_FALLBACK_URLS is required for NVDAx distribution.");
  }

  const body = payload.payload || {};
  const dryRun = payload.dryRun === true;
  const connection = await createSolanaConnection(process.env, { commitment: "confirmed" });
  const mint = new PublicKey(config.wbtcMint);
  const hasSigner = hasConfiguredKeypair(DISTRIBUTOR_KEYPAIR_CONFIG);
  const signer = dryRun && !hasSigner ? null : readKeypair();
  const authority = signer?.publicKey || new PublicKey(body.distributorWallet || config.distributorWallet || "");

  if (config.distributorWallet && authority.toBase58() !== config.distributorWallet && !body.allowSignerMismatch) {
    throw new Error(
      `Distributor signer ${authority.toBase58()} does not match the configured distribution wallet ${config.distributorWallet}. Set WALLET/WALLET_PRIVATE_KEY correctly or pass allowSignerMismatch only if this is intentional.`
    );
  }

  const decimals = Number(body.decimals ?? (await tokenDecimals(connection, mint)));
  const createAtas = body.createRecipientAtas ?? process.env.CREATE_RECIPIENT_ATAS !== "false";
  const sourceAta = associatedTokenAddress(authority, mint);
  const instructions = [];
  const recipients = [];

  for (const recipient of batch.recipients) {
    const wallet = new PublicKey(recipient.wallet || recipient.address);
    const destinationAta = associatedTokenAddress(wallet, mint);
    const amountRaw = uiAmountToRaw(recipientReward(recipient), decimals);
    if (amountRaw <= 0n) continue;
    if (createAtas) {
      instructions.push(createAtaIdempotentInstruction({ payer: authority, owner: wallet, mint, ata: destinationAta }));
    }
    instructions.push(
      transferCheckedInstruction({
        source: sourceAta,
        mint,
        destination: destinationAta,
        owner: authority,
        amountRaw,
        decimals
      })
    );
    recipients.push({
      wallet: wallet.toBase58(),
      destinationAta: destinationAta.toBase58(),
      amountRaw: amountRaw.toString(),
      reward: recipient.reward
    });
  }

  if (!instructions.length) {
    throw new Error("Prepared batch has no positive NVDAx rewards to transfer.");
  }

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = authority;
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;

  if (dryRun) {
    return {
      dryRun: true,
      status: "built",
      signer: authority.toBase58(),
      sourceAta: sourceAta.toBase58(),
      mint: mint.toBase58(),
      decimals,
      instructionCount: instructions.length,
      recipientCount: recipients.length,
      recipients,
      message: "Dry run built the NVDAx transfer transaction. Disable Dry run to sign and send."
    };
  }

  const signature = await sendAndConfirmTransaction(connection, transaction, [signer], {
    commitment: "confirmed",
    maxRetries: Number(body.maxRetries || 3)
  });

  return {
    dryRun: false,
    status: "confirmed",
    signature,
    signer: authority.toBase58(),
    sourceAta: sourceAta.toBase58(),
    mint: mint.toBase58(),
    decimals,
    instructionCount: instructions.length,
    recipientCount: recipients.length,
    recipients
  };
}

module.exports = {
  associatedTokenAddress,
  distributeWbtcBatch,
  uiAmountToRaw
};
