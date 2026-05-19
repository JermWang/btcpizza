# Fee Vault Program

Anchor program for receipt records, epochs, distribution manifest hashes, airdrop batch receipts, optional fallback claims, and pause controls.

## Accounts

- `Config`: authorities, mints, vaults, pause state, limits.
- `Epoch`: reward period, allocated wrapped-BTC amount, lifecycle state.
- `Receipt`: fee-intake/swap/deposit/snapshot/airdrop metadata.
- `DistributionManifest`: manifest hash, recipient count, total amount, status.
- `AirdropBatch`: batch hash, transaction signature reference, recipient count, total amount.
- `FallbackClaimWindow`: optional open and close timestamps.
- `FallbackClaimRecord`: replay protection for wallet + epoch.

## Instructions

- `initialize_config`
- `update_config`
- `create_epoch`
- `record_receipt`
- `set_distribution_manifest_hash`
- `record_airdrop_batch`
- `set_fallback_merkle_root`
- `open_fallback_claim_window`
- `close_fallback_claim_window`
- `fallback_claim`
- `pause`
- `unpause`

## Test Scenarios

- Cannot record a manifest for an unauthorized epoch.
- Cannot record duplicate receipts.
- Cannot record duplicate airdrop batches.
- Cannot fallback-claim before the window opens.
- Cannot fallback-claim after close.
- Cannot fallback-claim twice.
- Cannot fallback-claim with invalid proof.
- Cannot operate while paused, except unpause.
- Admin-only instructions reject unauthorized signers.
