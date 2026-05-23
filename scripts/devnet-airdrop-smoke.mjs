import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";

const require = createRequire(import.meta.url);
const { fetchHolderSnapshot } = require("../lib/rpc-holders.js");
const { rpcRequest } = require("../lib/solana-rpc.js");
const { associatedTokenAddress, distributeNvdaxBatch } = require("../lib/nvdax-distributor.js");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";

function loadEnv(file = ".env") {
  const env = {};
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  Object.assign(process.env, env);
  return env;
}

async function mainnetRpc(method, params) {
  return await rpcRequest(method, params, process.env);
}

function initializeMintInstruction(mint, decimals, mintAuthority, freezeAuthority = null) {
  const data = Buffer.alloc(70);
  data.writeUInt8(0, 0);
  data.writeUInt8(decimals, 1);
  mintAuthority.toBuffer().copy(data, 2);
  if (freezeAuthority) {
    data.writeUInt32LE(1, 34);
    freezeAuthority.toBuffer().copy(data, 38);
  }
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data
  });
}

function createAtaIdempotentInstruction({ payer, owner, mint, ata }) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1])
  });
}

function mintToInstruction({ mint, destination, authority, amountRaw }) {
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(BigInt(amountRaw), 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false }
    ],
    data
  });
}

function loadOrCreateKeypair(filePath) {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(filePath, "utf8"))));
  } catch {
    const keypair = Keypair.generate();
    writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)));
    return keypair;
  }
}

async function fundDevnetWallet(connection, wallet) {
  const minimumLamports = Number(process.env.DEVNET_MIN_DISTRIBUTOR_LAMPORTS || 100_000_000);
  const existingBalance = await connection.getBalance(wallet, "confirmed");
  if (existingBalance >= minimumLamports) {
    return { signature: "", lamports: 0, existingBalance, fundedByExistingBalance: true };
  }

  const amounts = [1_000_000_000, 500_000_000, 250_000_000];
  let lastError;
  for (const lamports of amounts) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const signature = await connection.requestAirdrop(wallet, lamports);
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction({ signature, ...latest }, "confirmed");
        return { signature, lamports };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  const error = new Error(
    [
      "Devnet funding failed.",
      `Distributor: ${wallet.toBase58()}`,
      `RPC: ${connection.rpcEndpoint}`,
      "Fund that address with devnet SOL, then rerun `node scripts/devnet-airdrop-smoke.mjs`.",
      "Useful faucets: https://faucet.solana.com/ or a paid Helius devnet faucet/RPC if available."
    ].join("\n")
  );
  error.cause = lastError;
  throw error;
}

async function main() {
  const env = loadEnv();
  const dryRunBuildOnly = process.argv.includes("--dry-run-build");
  const snapshot = await fetchHolderSnapshot({
    tokenMint: env.PUBLIC_TOKEN_MINT,
    rpc: mainnetRpc,
    minBalanceUi: Number(env.HOLDER_SNAPSHOT_MIN_BALANCE || 0),
    excludedWallets: []
  });
  const recipients = snapshot.holders.slice(0, Number(process.env.DEVNET_AIRDROP_RECIPIENTS || 3)).map((holder, index) => ({
    wallet: holder.owner,
    reward: "0.000001",
    rank: index + 1,
    sourceBalance: holder.balanceUi
  }));
  if (!recipients.length) throw new Error("No eligible holders found for devnet airdrop smoke test.");

  const devnetRpcUrl = process.env.DEVNET_RPC_URL || DEFAULT_DEVNET_RPC_URL;
  const connection = new Connection(devnetRpcUrl, "confirmed");
  const testDir = join(process.cwd(), ".admin-data", "devnet-test");
  mkdirSync(testDir, { recursive: true });

  const keypairPath = process.env.DEVNET_DISTRIBUTOR_KEYPAIR_PATH || join(testDir, "distributor.json");
  const distributor = loadOrCreateKeypair(keypairPath);
  const mint = Keypair.generate();

  if (dryRunBuildOnly) {
    const oldEnv = {
      SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
      DISTRIBUTOR_DRY_RUN: process.env.DISTRIBUTOR_DRY_RUN,
      DISTRIBUTOR_KEYPAIR_PATH: process.env.DISTRIBUTOR_KEYPAIR_PATH,
      DISTRIBUTOR_PRIVATE_KEY_BASE58: process.env.DISTRIBUTOR_PRIVATE_KEY_BASE58,
      CREATE_RECIPIENT_ATAS: process.env.CREATE_RECIPIENT_ATAS
    };
    try {
      process.env.SOLANA_RPC_URL = devnetRpcUrl;
      process.env.DISTRIBUTOR_DRY_RUN = "true";
      process.env.DISTRIBUTOR_KEYPAIR_PATH = keypairPath;
      process.env.DISTRIBUTOR_PRIVATE_KEY_BASE58 = "";
      process.env.CREATE_RECIPIENT_ATAS = "true";

      const result = await distributeNvdaxBatch({
        batch: {
          id: `devnet_dry_run_${Date.now()}`,
          manifestId: "devnet_dry_run_manifest",
          recipients
        },
        config: {
          nvdaxMint: mint.publicKey.toBase58(),
          distributorWallet: distributor.publicKey.toBase58()
        },
        payload: {
          dryRun: true,
          payload: { decimals: 6 }
        }
      });

      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRunBuildOnly: true,
            mainnetHolderSourceMint: env.PUBLIC_TOKEN_MINT,
            devnetRpcUrl,
            scannedEligibleHolders: snapshot.totalEligible,
            scannedExcludedHolders: snapshot.totalExcluded,
            devnetDistributor: distributor.publicKey.toBase58(),
            devnetMockMint: mint.publicKey.toBase58(),
            instructionCount: result.instructionCount,
            recipientCount: result.recipientCount,
            recipients: result.recipients
          },
          null,
          2
        )
      );
      return;
    } finally {
      Object.assign(process.env, oldEnv);
    }
  }

  const devnetFunding = await fundDevnetWallet(connection, distributor.publicKey);
  const decimals = 6;
  const sourceAta = associatedTokenAddress(distributor.publicKey, mint.publicKey);
  const mintRent = await connection.getMinimumBalanceForRentExemption(82);
  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: distributor.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: 82,
      programId: TOKEN_PROGRAM_ID
    }),
    initializeMintInstruction(mint.publicKey, decimals, distributor.publicKey),
    createAtaIdempotentInstruction({
      payer: distributor.publicKey,
      owner: distributor.publicKey,
      mint: mint.publicKey,
      ata: sourceAta
    }),
    mintToInstruction({
      mint: mint.publicKey,
      destination: sourceAta,
      authority: distributor.publicKey,
      amountRaw: 1_000_000n
    })
  );
  const createMintSig = await sendAndConfirmTransaction(connection, createMintTx, [distributor, mint], {
    commitment: "confirmed",
    maxRetries: 3
  });

  const oldEnv = {
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    DISTRIBUTOR_DRY_RUN: process.env.DISTRIBUTOR_DRY_RUN,
    DISTRIBUTOR_KEYPAIR_PATH: process.env.DISTRIBUTOR_KEYPAIR_PATH,
    DISTRIBUTOR_PRIVATE_KEY_BASE58: process.env.DISTRIBUTOR_PRIVATE_KEY_BASE58,
    CREATE_RECIPIENT_ATAS: process.env.CREATE_RECIPIENT_ATAS
  };

  try {
    process.env.SOLANA_RPC_URL = devnetRpcUrl;
    process.env.DISTRIBUTOR_DRY_RUN = "false";
    process.env.DISTRIBUTOR_KEYPAIR_PATH = keypairPath;
    process.env.DISTRIBUTOR_PRIVATE_KEY_BASE58 = "";
    process.env.CREATE_RECIPIENT_ATAS = "true";

    const result = await distributeNvdaxBatch({
      batch: {
        id: `devnet_test_${Date.now()}`,
        manifestId: "devnet_test_manifest",
        recipients
      },
      config: {
        nvdaxMint: mint.publicKey.toBase58(),
        distributorWallet: distributor.publicKey.toBase58()
      },
      payload: {
        dryRun: false,
        payload: { decimals, maxRetries: 3 }
      }
    });

    const balances = [];
    for (const recipient of result.recipients) {
      const balance = await connection.getTokenAccountBalance(new PublicKey(recipient.destinationAta));
      balances.push({
        wallet: recipient.wallet,
        destinationAta: recipient.destinationAta,
        uiAmountString: balance.value.uiAmountString
      });
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mainnetHolderSourceMint: env.PUBLIC_TOKEN_MINT,
          devnetRpcUrl,
          scannedEligibleHolders: snapshot.totalEligible,
          scannedExcludedHolders: snapshot.totalExcluded,
          devnetDistributor: distributor.publicKey.toBase58(),
          devnetMockMint: mint.publicKey.toBase58(),
          devnetFundSig: devnetFunding.signature,
          devnetFundLamports: devnetFunding.lamports,
          createMintSig,
          distributeSig: result.signature,
          instructionCount: result.instructionCount,
          recipientCount: result.recipientCount,
          recipients: balances
        },
        null,
        2
      )
    );
  } finally {
    Object.assign(process.env, oldEnv);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
