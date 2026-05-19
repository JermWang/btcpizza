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

- Choose exact WBTC / BTC asset mint.
- Confirm liquidity route and slippage limits.
- Decide whether failed/dust rewards roll over or become fallback claims.

## Custody

Current preference: Privy or equivalent operational wallet, with production hardening.

Recommended:

- Fee-owner wallet: Privy-controlled or multisig.
- WBTC vault: multisig or program-owned token account.
- Distributor wallet: hot wallet with limited WBTC funding per batch.

## Airdrop Cadence

Decision: expanding airdrop intervals.

Default:

```text
3 minutes -> 5 minutes -> 10 minutes -> 15 minutes -> 30 minutes -> 1 hour -> 2 hours -> 4 hours -> 8 hours -> 12 hours -> 24 hours
```

After the final step, repeat every 24 hours unless admin/governance changes the schedule.

Open details:

- Decide whether the schedule starts at token launch or first confirmed creator-fee intake.
- Decide minimum fee balance required to execute a swap/distribution.
- Decide whether skipped low-balance epochs advance the schedule or retry the same interval.

## Holder Score

Choose one:

- Pure time-weighted average balance.
- Time-weighted average balance plus loyalty multiplier.
- Time-weighted average balance plus whale cap.

## Minimum Airdrop Policy

Choose one:

- Send to every eligible holder and pay ATA creation rent.
- Set a minimum WBTC amount and roll dust forward.
- Set a minimum token holding score threshold.
- Direct-send above threshold and fallback-claim below threshold.
