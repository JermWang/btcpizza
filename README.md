# Jensen Strategy

Public Solana dashboard and airdrop system for a Michael Saylor-inspired Bitcoin treasury parody token whose Pump.fun creator fees are periodically converted into wrapped BTC on Solana and automatically distributed to holders by token balance at the epoch snapshot.

This repository is intentionally structured as a full project brief plus implementation scaffold. It should be treated as the source of truth before smart contract development begins.

## Feasibility Summary

This is possible, with the right expectations.

Pump.fun creator fees can be treated as the fee source of record. The creator-fee or fee-owner wallet receives fee value, a keeper converts those fees into wrapped BTC on Solana, and a distributor sends deterministic batched nvdax airdrops to eligible holders. The public website indexes every fee intake, swap, snapshot, distribution manifest, airdrop batch, and recipient transfer.

The hard part is automatic distribution at scale. A Solana program cannot iterate through every holder in one transaction. The practical model is deterministic off-chain snapshotting plus batched SPL-token transfers, with every manifest hash and batch transaction signature published on-chain and in the dashboard.

## Core Product

- Token page with countdown to Jensen Strategy airdrop cycles, using an expanding interval schedule.
- Public receipt feed for creator-fee intake, swaps, nvdax vault deposits, snapshots, and airdrop batches.
- Holder dashboard showing current estimated airdrop entitlement.
- Airdrop verification page where holders can see whether their wallet was included and whether the nvdax transfer landed.
- Admin/keeper dashboard for authorized fee collection, buy cycles, and distribution batches.
- Public API and indexer for transparent historical accounting.

## Proposed Stack

- `apps/web`: Next.js app with wallet connection, dashboard, receipts, airdrop verification, and admin tools.
- `apps/indexer`: Worker that reads Solana transactions/accounts and writes normalized receipts, balances, snapshots, and distribution manifests.
- `programs/fee_vault`: Anchor program for epochs, receipt records, distribution manifests, batch hashes, and optional fallback claims.
- `scripts/keeper`: Bot that runs every 4 hours to collect creator fees, execute swaps, and submit receipts.
- `scripts/distributor`: Batched wrapped-BTC airdrop sender.
- `packages/sdk`: Shared TypeScript client for program instructions and typed account reads.
- `docs`: Product, architecture, math, security, and build prompts.

## Admin Control Page

The static preview includes a password-gated admin operations console at `/admin`.

Built-in controls validate config, refresh fee receipts, scan holders directly through Solana RPC, check the nvdax vault, create holder snapshots, simulate weighted nvdax distributions, record receipts, lock manifests, and prepare idempotent distribution batches. `Official Live GO` is the only admin start button: after it arms automation, an external cron service calls the cron endpoint every minute. When an epoch is due, the cron runner claims creator fees, buys nvdax, snapshots holders for the token mint, distributes nvdax to holders by weighted balance, and records screenshot evidence through `ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL`.

See `docs/ADMIN_OPERATIONS.md` and `.env.example` for the required `ADMIN_PASSWORD`, `CRON_SECRET`, RPC holder fallback, signing keys, and optional screenshot/per-action webhook variables.

The live env model is one wallet by default: `WALLET`, `WALLET_PRIVATE_KEY`, `TOKEN_MINT`, `REWARD_MINT`, `SOLANA_RPC_URL`, and `CRON_SECRET`. Split creator/swap/distributor envs are routing overrides, not the default setup.

### cron-job.org setup

Use one fixed external heartbeat. The database decides whether the current epoch is due.

```text
URL: https://www.btcpizzastrategy.xyz/api/cron/epoch-tick
Method: POST
Headers:
  Content-Type: application/json
  Authorization: Bearer <CRON_SECRET>
Body:
  { "source": "cron-job.org" }
Frequency: every 1 minute
```

Do not add Vercel Cron jobs. The endpoint is lock-protected, idempotent, and cheap when no epoch is due. Do not include `"task":"epoch-tick"` in the cron body; the production cron endpoint always runs the full due-epoch automation path after `Official Live GO` has armed it.

## MVP Recommendation

1. Launch through Pump.fun with creator fees routed to a dedicated treasury wallet.
2. Track the treasury wallet as the canonical creator-fee intake account.
3. Keeper follows an exponential airdrop schedule: the interval starts at 3 minutes and doubles every epoch forever.
4. The holder inclusion cap also doubles every epoch, starting from the configured base cap.
5. At each scheduled epoch, keeper converts collected fees into wrapped BTC on Solana if balances meet minimum thresholds.
6. Indexer computes holder-time-weighted allocations for the distribution epoch.
7. Distributor sends nvdax airdrops in batches, creating recipient ATAs when policy allows.
8. Program records receipt hashes for the fee intake, swap, snapshot manifest, and each airdrop batch.

## Important Design Decision

Do not promise native BTC. For the first version, the technically honest promise is:

> Pump.fun creator fees are transparently converted into wrapped BTC on Solana and automatically airdropped to eligible holders.

Automatic airdrops are more visible than claims, but they have operating costs. If a holder lacks a wrapped-BTC associated token account, the distributor must create it and pay rent. Add a minimum payout threshold so the project does not spend more creating token accounts than the airdrop is worth.

## Repository Map

```text
apps/
  web/              # public dashboard and holder airdrop UI
  indexer/          # Solana event/account indexer
packages/
  sdk/              # typed TS client helpers
programs/
  fee_vault/        # Anchor program scaffold
scripts/
  keeper/           # 4-hour creator-fee collection and buy bot
  distributor/      # batched nvdax airdrop sender
docs/
  PRODUCT_SPEC.md
  ARCHITECTURE.md
  CLAIMS_MATH.md
  SECURITY_AND_LEGAL.md
  IMPLEMENTATION_PROMPT.md
```

## Next Implementation Steps

Use `docs/IMPLEMENTATION_PROMPT.md` as the prompt for an implementation agent. Before writing production code, confirm:

- Pump.fun fee-owner / creator-fee wallet setup.
- Whether creator fees are paid automatically or must be explicitly collected.
- Wrapped BTC mint and liquidity route.
- Custody model: Privy server wallet, Squads multisig, program PDA, or hybrid.
- Snapshot cadence and anti-gaming rules.
- Expanding interval policy and skipped-epoch behavior.
- Minimum payout threshold and ATA rent budget.
- Jurisdictional review for reward/airdrop language.

## Current External Assumptions

- Pump.fun's public fee docs say creator fees exist for eligible coins and are paid to the token creator / fee owner, with fee rates depending on bonding-curve or PumpSwap state.
- Pump.fun's terms say creator fees can be routed to configured wallet addresses, and that fee collection/distribution can depend on network, smart contract, and third-party infrastructure conditions.
- These mechanics can change, so production code should read on-chain transactions and treasury wallet balances rather than relying only on website estimates.
