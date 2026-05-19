# BTC Pizza Day Fee Airdrops

Public Solana dashboard and airdrop system for a BTC Pizza Day token whose Pump.fun creator fees are periodically converted into wrapped BTC on Solana and automatically distributed to holders based on holding weight and holding time.

This repository is intentionally structured as a full project brief plus implementation scaffold. It should be treated as the source of truth before smart contract development begins.

## Feasibility Summary

This is possible, with the right expectations.

Pump.fun creator fees can be treated as the fee source of record. The creator-fee or fee-owner wallet receives fee value, a keeper converts those fees into wrapped BTC on Solana, and a distributor sends deterministic batched WBTC airdrops to eligible holders. The public website indexes every fee intake, swap, snapshot, distribution manifest, airdrop batch, and recipient transfer.

The hard part is automatic distribution at scale. A Solana program cannot iterate through every holder in one transaction. The practical model is deterministic off-chain snapshotting plus batched SPL-token transfers, with every manifest hash and batch transaction signature published on-chain and in the dashboard.

## Core Product

- Token page with countdown to BTC Pizza Day airdrop cycles, using an expanding interval schedule.
- Public receipt feed for creator-fee intake, swaps, WBTC vault deposits, snapshots, and airdrop batches.
- Holder dashboard showing current estimated airdrop entitlement.
- Airdrop verification page where holders can see whether their wallet was included and whether the WBTC transfer landed.
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

## MVP Recommendation

1. Launch through Pump.fun with creator fees routed to a dedicated treasury wallet.
2. Track the treasury wallet as the canonical creator-fee intake account.
3. Keeper follows an expanding airdrop schedule: 3m, 5m, 10m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, then 24h repeat.
4. At each scheduled epoch, keeper converts collected fees into wrapped BTC on Solana if balances meet minimum thresholds.
5. Indexer computes holder-time-weighted allocations for the distribution epoch.
6. Distributor sends WBTC airdrops in batches, creating recipient ATAs when policy allows.
7. Program records receipt hashes for the fee intake, swap, snapshot manifest, and each airdrop batch.

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
  distributor/      # batched WBTC airdrop sender
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
