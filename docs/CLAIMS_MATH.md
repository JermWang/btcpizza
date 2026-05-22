# Airdrop Math

## Goal

Distribute each airdrop epoch proportionally to holders based on both amount held and duration held.

## Definitions

- `epoch_start`: start timestamp for the reward epoch.
- `epoch_end`: end timestamp for the reward epoch.
- `balance_i(t)`: holder `i` token balance at time `t`.
- `eligible_balance_i(t)`: balance excluding treasury, LP, burn, team, and denylisted accounts.
- `score_i`: holder score.
- `reward_pool`: wrapped BTC amount allocated to the epoch.
- `interval_n`: duration of the current airdrop epoch.
- `schedule_step_n`: index in the expanding airdrop schedule.

## Baseline Formula

```text
score_i = integral(epoch_start, epoch_end, eligible_balance_i(t) dt)
airdrop_i = reward_pool * score_i / sum(score_all_holders)
```

This is time-weighted average balance. It rewards both size and duration without requiring a holder to be present only at the final snapshot.

## Practical Snapshot Approximation

Instead of integrating every slot:

```text
score_i = sum(balance_i_at_snapshot_k * snapshot_interval_seconds)
```

Recommended cadence:

- During fast early intervals: snapshot at interval start and interval end.
- During longer intervals: snapshot every 5-15 minutes.
- MVP fallback: hourly snapshots after the schedule reaches daily intervals.
- Avoid per-slot snapshots unless there is a strong reason.

## Expanding Interval Schedule

The distribution cadence should be configurable.

Recommended default:

```text
base_interval = 3m
interval_multiplier = 2
base_holder_cap = 5
holder_cap_multiplier = 2
```

The next interval and holder inclusion cap are selected by epoch number:

```text
interval_n = base_interval * interval_multiplier ^ epoch_index
holder_cap_n = base_holder_cap * holder_cap_multiplier ^ epoch_index
next_airdrop_at = previous_airdrop_at + interval_n
```

The schedule does not roll into a fixed daily repeat. It continues doubling by epoch unless admin/governance changes the cadence.

The reward pool grows naturally as intervals increase:

```text
reward_pool_n = WBTC_acquired_during_interval_n + rolled_over_dust_n
```

This creates small early airdrops for attention and proof-of-execution, then progressively larger and broader later airdrops as fees accumulate for longer windows and more holders become eligible.

## Loyalty Multiplier

Optional:

```text
multiplier_i = min(1.25, 1 + uninterrupted_hold_seconds / epoch_duration * 0.25)
adjusted_score_i = score_i * multiplier_i
```

Use this carefully. Multipliers are easy to market but increase edge cases.

## Whale Cap

Optional:

```text
capped_score_i = min(adjusted_score_i, max_score_percent * total_adjusted_score)
```

This requires redistribution of excess scores and should be explicitly documented before launch.

## Anti-Gaming Rules

- Exclude treasury, LP, burn, team, and known program accounts.
- Decide whether staked/locked tokens count.
- Decide whether tokens inside DEX pools count for LP providers.
- Penalize or exclude accounts created after epoch close.
- Snapshot before announcing exact reward pool if manipulation risk is high.

## Airdrop Implementation

Off-chain indexer computes:

- Wallet.
- Airdrop amount.
- Score.
- Epoch.
- Distribution manifest row.

Manifest row:

```text
epoch, wallet, score, amount, token_account, ata_created, status
```

The manifest hash is recorded on-chain before distribution starts:

```text
manifest_hash = sha256(canonical_json(distribution_manifest))
```

The distributor then sends wrapped BTC transfers in batches and records batch receipts.

## Fallback Claims

Use fallback Merkle claims only for:

- Recipients whose transfers failed.
- Dust below the direct airdrop threshold.
- Recipients whose WBTC ATA could not be created under the distribution policy.

Fallback claims should verify:

- Epoch fallback window is open.
- Merkle root matches.
- Wallet has not claimed.
- Proof resolves to `(wallet, epoch, amount, score)`.
