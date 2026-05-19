# Keeper

Cron-compatible worker that runs Pump.fun creator-fee collection and wrapped-BTC acquisition on an expanding airdrop schedule.

## Cycle

1. Calculate the next interval from the configured expanding schedule.
2. Read Pump.fun creator-fee treasury balances.
3. Collect available creator fees if the Pump.fun flow requires an explicit claim.
4. Quote swap route.
5. Validate slippage and max spend.
6. Execute swap if minimum thresholds are met.
7. Confirm wrapped-BTC vault deposit.
8. Submit fee intake and swap receipts to the fee vault program.
9. Queue or trigger distribution manifest generation.
10. Emit structured logs and alerts.

## Adapter Interfaces

- `FeeSourceAdapter`
  - `getAvailableFees()`
  - `collect()`
- `SwapAdapter`
  - `quote()`
  - `execute()`
- `ReceiptAdapter`
  - `buildReceipt()`
  - `submitReceipt()`
- `DistributionQueueAdapter`
  - `queueEpoch()`
  - `getPendingEpochs()`
- `AirdropSchedule`
  - `getCurrentInterval()`
  - `getNextAirdropAt()`
  - `advance()`

## Modes

- `dry-run`: quote and build transactions without submitting.
- `devnet`: local/devnet testing.
- `mainnet`: production execution with stricter limits.
