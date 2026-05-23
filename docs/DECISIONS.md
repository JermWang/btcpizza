# Open Decisions

These decisions should be finalized before production implementation.

## Fee Source

Decision: Pump.fun creator fees.

Open details:

- Confirm fee-owner wallet.
- Confirm whether creator fees are paid automatically or require an explicit collect instruction.
- Confirm how post-graduation PumpSwap creator fees are received.
- Confirm whether Pump.fun Cashback mode is available/desirable at launch.

## BTC Asset

Decision: wrapped BTC on Solana.

Open details:

- Choose exact nvdax / BTC asset mint.
- Confirm liquidity route and slippage limits.
- Decide whether failed/dust rewards roll over or become fallback claims.

## Custody

Current preference: Privy or equivalent operational wallet, with production hardening.

Recommended:

- Fee-owner wallet: Privy-controlled or multisig.
- nvdax vault: multisig or program-owned token account.
- Distributor wallet: hot wallet with limited nvdax funding per batch.

## Airdrop Cadence

Decision: exponential airdrop intervals and holder caps.

Default:

```text
interval_n = 3 minutes * 2^epoch_index
holder_cap_n = 5 holders * 2^epoch_index
```

Both values continue doubling unless admin/governance changes the schedule.

Open details:

- Decide whether the schedule starts at token launch or first confirmed creator-fee intake.
- Decide minimum fee balance required to execute a swap/distribution.
- Decide whether skipped low-balance epochs advance the exponential schedule or retry the same interval.

## Holder Score

Choose one:

- Pure time-weighted average balance.
- Time-weighted average balance plus loyalty multiplier.
- Time-weighted average balance plus whale cap.

## Minimum Airdrop Policy

Choose one:

- Send to every eligible holder and pay ATA creation rent.
- Set a minimum nvdax amount and roll dust forward.
- Set a minimum token holding score threshold.
- Direct-send above threshold and fallback-claim below threshold.
