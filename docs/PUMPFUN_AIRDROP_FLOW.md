# Pump.fun Creator Fee To WBTC Airdrop Flow

## Objective

Automatically track token holders and distribute wrapped BTC on Solana using Pump.fun creator fees.

## End-To-End Flow

1. Pump.fun routes creator fees to the configured creator-fee owner or treasury wallet.
2. Indexer watches the treasury wallet and labels eligible creator-fee inflows.
3. Keeper reads available treasury funds at each scheduled airdrop interval.
4. Keeper swaps treasury funds into wrapped BTC on Solana.
5. Keeper records fee-intake and swap receipts.
6. Indexer snapshots token holders for the epoch.
7. Indexer calculates each holder's time-weighted score.
8. Indexer creates a deterministic distribution manifest.
9. Program/admin records the manifest hash.
10. Distributor sends WBTC to holders in batches.
11. Distributor records each batch transaction.
12. Indexer streams the new receipt and batch status to connected browsers.
13. Website shows every wallet's status: included, sent, failed, rolled over, or fallback-claimable without requiring refresh.

## Holder Tracking

The indexer should track:

- Token account owner.
- Token account balance.
- Balance changes over time.
- Wallet-level aggregate balance across token accounts.
- Excluded wallets.
- Snapshot timestamp and slot.

The indexer should calculate a holder score:

```text
score = sum(wallet_balance_at_snapshot * snapshot_interval_seconds)
```

This rewards wallets that hold more tokens and hold them for longer.

## Airdrop Distribution Manifest

Each epoch produces a canonical JSON manifest:

```json
{
  "epoch": "2026-bitcoin-pizza-strategy-001",
  "projectTokenMint": "...",
  "wbtcMint": "...",
  "rewardPoolAmount": "123456",
  "snapshotStartSlot": 0,
  "snapshotEndSlot": 0,
  "recipients": [
    {
      "wallet": "...",
      "score": "1000000000",
      "amount": "1234",
      "tokenAccount": "...",
      "status": "pending"
    }
  ]
}
```

The manifest hash is recorded before distribution:

```text
manifest_hash = sha256(canonical_json(manifest))
```

## Expanding Airdrop Cadence

The airdrop schedule should start fast and become progressively slower so early holders see immediate proof-of-life distributions while later payouts become larger and include more holders.

Recommended default:

```text
interval_n = 3 minutes * 2^epoch_index
holder_cap_n = 5 holders * 2^epoch_index
```

Both values continue doubling unless governance/admin config changes it.

Each interval creates one distribution epoch:

```text
epoch_start = previous_airdrop_at
epoch_end = scheduled_airdrop_at
reward_pool = WBTC acquired since previous epoch + rolled-over dust
```

This means the first airdrops are small and frequent, while later airdrops naturally get larger and broader because more creator fees accumulate between distributions and the inclusion cap expands.

## Airdrop Execution

The distributor sends WBTC using bounded batches.

Batch rules:

- Maximum recipients per transaction.
- Maximum WBTC per batch.
- Minimum payout amount.
- ATA creation enabled or disabled.
- Retry count for failed rows.

If a recipient has no WBTC associated token account, the project must choose:

- Create the ATA and pay rent.
- Skip and roll forward.
- Put the holder into fallback claims.

## Recommended MVP Policy

- Use exponential airdrop intervals and holder inclusion caps: both start from configured base values and double each epoch.
- Swap creator fees into WBTC at each distribution epoch if the fee balance is above the minimum swap threshold.
- Direct-send only above a minimum WBTC threshold.
- Create recipient ATAs only for payouts above the threshold.
- Roll dust forward until it exceeds the threshold.
- Use fallback claims only for failed transfers.

## Live Website Updates

The production website should subscribe to the indexer's live event stream.

Required live updates:

- Countdown reconciliation.
- New creator-fee intake receipt.
- New swap receipt.
- Manifest finalized.
- Airdrop batch sent.
- Failed-recipient list updated.
- Holder estimate updated.

Use WebSockets when the app needs bidirectional admin/keeper controls. Use Server-Sent Events for the public dashboard if the stream is read-only.
