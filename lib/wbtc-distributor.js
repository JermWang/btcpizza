const fs = require("node:fs");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} = require("@solana/web3.js");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function readKeypair(filePath) {
  if (!filePath) {
    throw new Error("DISTRIBUTOR_KEYPAIR_PATH is required for live WBTC distribution.");
  }
  const bytes = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
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
  if (!process.env.SOLANA_RPC_URL) {
    throw new Error("SOLANA_RPC_URL is required for WBTC distribution.");
  }

  const body = payload.payload || {};
  const dryRun = payload.dryRun !== false || process.env.DISTRIBUTOR_DRY_RUN !== "false";
  const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  const mint = new PublicKey(config.wbtcMint);
  const signer = dryRun && !process.env.DISTRIBUTOR_KEYPAIR_PATH ? null : readKeypair(process.env.DISTRIBUTOR_KEYPAIR_PATH);
  const authority = signer?.publicKey || new PublicKey(body.distributorWallet || config.distributorWallet || "");

  if (config.distributorWallet && authority.toBase58() !== config.distributorWallet && !body.allowSignerMismatch) {
    throw new Error(
      `Distributor signer ${authority.toBase58()} does not match PUBLIC_DISTRIBUTOR_WALLET ${config.distributorWallet}. Set the right keypair or pass allowSignerMismatch only if this is intentional.`
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
    throw new Error("Prepared batch has no positive WBTC rewards to transfer.");
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
      message: "Dry run built the WBTC transfer transaction. Disable Dry run to sign and send."
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
