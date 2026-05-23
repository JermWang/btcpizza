# Implementation Prompt

Use this prompt to build the repo from this blueprint.

```text
You are building a production-grade Solana project called Jensen Strategy.

Goal:
Create a public website, Solana Anchor program, indexer, keeper, airdrop distributor, and TypeScript SDK for a Michael Saylor-inspired Bitcoin treasury parody token whose Pump.fun creator fees are periodically converted into wrapped BTC on Solana and automatically airdropped to holders through transparent receipt records.

Repository structure:
- apps/web: Next.js App Router, TypeScript, Tailwind, wallet connection, public dashboard, receipts feed, holder airdrop verification UI, admin/keeper UI.
- apps/web visuals: high-end generated hero assets plus editable 3D/data-driven pizza pool graphics.
- apps/indexer: TypeScript worker, Solana RPC subscriptions/polling, Postgres persistence, holder balance history, snapshot generation, distribution manifest output, optional Merkle fallback output, and live event streaming.
- programs/fee_vault: Anchor program with config, epochs, receipts, distribution manifest hashes, airdrop batch receipts, optional fallback claim windows, pause controls.
- scripts/keeper: TypeScript keeper that runs every 4 hours, detects/collects Pump.fun creator fees, swaps through a configurable route, deposits wrapped BTC, submits receipts, and queues distribution.
- scripts/keeper: TypeScript keeper that follows an expanding airdrop schedule, detects/collects Pump.fun creator fees, swaps through a configurable route, deposits wrapped BTC, submits receipts, and queues distribution.
- scripts/distributor: TypeScript distributor that executes deterministic wrapped-BTC airdrop manifests in batches.
- packages/sdk: Shared typed client for program account reads and instructions.
- docs: Architecture, product spec, airdrop math, security/legal notes.

Core product requirements:
1. Public dashboard displays:
   - treasury slice countdown.
   - next buy/airdrop cycle countdown.
   - current airdrop interval and next interval.
   - total creator fees collected.
   - total wrapped BTC acquired.
   - active and historical airdrop epochs.
   - on-chain receipt feed.
   - live updates without manual refresh.
   - editable pizza-pool visual showing slice count, active epoch, distributed slices, pending slices, and nvdax pool amount.
2. Holder dashboard displays:
   - connected wallet token balance.
   - estimated epoch score.
   - estimated airdrop amount.
   - airdrop inclusion and transfer status.
   - fallback claim status if direct transfer failed.
3. Admin dashboard supports:
   - keeper/distributor wallet connection.
   - trigger Pump.fun creator-fee collection.
   - trigger buy cycle.
   - submit receipt.
   - finalize distribution manifest.
   - send airdrop batch.
   - open fallback claim windows.
   - pause protocol.
4. Anchor program supports:
   - initialize_config.
   - update_config.
   - create_epoch.
   - record_receipt.
   - set_distribution_manifest_hash.
   - record_airdrop_batch.
   - set_fallback_merkle_root.
   - open_fallback_claim_window.
   - close_fallback_claim_window.
   - fallback_claim.
   - pause/unpause.
5. Indexer supports:
   - program receipt indexing.
   - Pump.fun creator-fee treasury intake detection.
   - token balance snapshotting.
   - holder score calculation.
   - deterministic distribution manifest generation.
   - optional fallback Merkle root generation.
   - deterministic snapshot JSON output.
   - WebSocket or Server-Sent Events stream for fee intake, swap, manifest, batch, holder estimate, and countdown updates.
6. Keeper supports:
   - cron-compatible execution using an exponential interval schedule.
   - default schedule: interval starts at 3m and doubles every epoch forever.
   - holder inclusion cap starts from the configured base cap and doubles every epoch forever.
   - PumpFunCreatorFeeSource adapter.
   - swap adapter interface.
   - dry-run mode.
   - slippage limits.
   - receipt submission.
   - structured logs.
7. Distributor supports:
   - batched SPL token transfers.
   - recipient nvdax ATA creation policy.
   - minimum payout threshold.
   - retry handling.
   - failed-recipient fallback manifest.

Important technical constraints:
- Native BTC cannot be bought or custodied directly by a Solana program. MVP must use wrapped BTC on Solana.
- The token is launched through Pump.fun. Creator fees should be treated as treasury inflows from the Pump.fun creator-fee / fee-owner wallet, verified by on-chain transaction history.
- Pump.fun fee rates and behavior can change. Do not hardcode fee percentages as accounting truth.
- Do not put complex DEX route selection inside the Anchor program. Route off-chain through the keeper and constrain the keeper with public receipts, multisig authority, slippage config, and max cycle limits.
- Automatic airdrops must be batched off-chain. A Solana program cannot iterate over all holders in one instruction.
- Airdrop cadence must be configurable and should use expanding intervals so early payouts are frequent and later payouts are larger.
- The website must live-update from the indexer stream and Solana subscription state; users should not need to refresh to see new receipts, countdown changes, or airdrop status.
- Use clear abstractions for fee sources: PumpFunCreatorFeeSource, ManualTreasuryFeeSource.
- Use clear abstractions for BTC acquisition: WrappedBtcSwapAdapter.
- Use clear abstractions for distribution: BatchedAirdropDistributor, FallbackClaimDistributor.
- Use generated raster imagery for hero/social art, but build live protocol graphics such as pizza-pool slice counts as editable code/3D components.

Quality bar:
- TypeScript strict mode.
- Anchor tests for every instruction and failure path.
- Unit tests for airdrop math, manifest hashing, and optional Merkle fallback proof generation.
- Unit tests for expanding interval schedule selection and next-airdrop calculation.
- Integration test for a full epoch: detect creator fees -> buy wrapped BTC -> record receipt -> snapshot -> finalize manifest -> send batch -> record batch receipt.
- Browser test proving the dashboard receives a simulated live receipt event and updates without reload.
- Dashboard must render directly from indexed receipts and program accounts.
- Every displayed number must show source transaction or account address.

Security requirements:
- Multisig-ready authorities.
- Pause controls.
- Fallback claim replay protection.
- Receipt uniqueness protection.
- Configurable excluded wallets.
- Deterministic snapshot artifact hashing.
- Deterministic distribution manifest hashing.
- Batched transfer idempotency.
- No hardcoded private keys.
- No promises of native BTC payout.

Build order:
1. Create monorepo tooling and shared config.
2. Implement Anchor program account model and tests.
3. Implement SDK instruction builders.
4. Implement indexer schema and receipt ingestion.
5. Implement airdrop math and deterministic manifest generator.
6. Implement keeper dry-run flow.
7. Implement distributor dry-run and batched transfer flow.
8. Implement web dashboard.
9. Implement 3D/data-driven pizza pool visual.
10. Add end-to-end localnet demo.
11. Add deployment docs and environment templates.

Deliverables:
- Working local dev environment.
- README with setup commands.
- Anchor test suite.
- Web dashboard running locally.
- Example snapshot and distribution manifest.
- Example receipt records.
- Example airdrop batch record.
- Editable pizza-pool visual component and asset source notes.
- Security checklist.
```
