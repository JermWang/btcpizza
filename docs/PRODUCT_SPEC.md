# Product Spec

## One-Liner

A Michael Saylor-inspired Bitcoin treasury parody whose Pump.fun creator fees are transparently converted into wrapped BTC on Solana and automatically airdropped to holders.

## Users

- Holders who want proof that fees are being used as promised.
- New buyers evaluating the project's transparency.
- Operators running the periodic creator-fee collection, BTC purchase, and airdrop workflow.
- Auditors/community members checking receipts and airdrop math.

## Public Website

### Home Dashboard

- Treasury slice countdown.
- Total creator fees collected.
- Total wrapped BTC acquired.
- Next buy cycle countdown.
- Next airdrop cycle countdown.
- Current airdrop interval and next interval.
- Current epoch status.
- Latest receipt feed.
- Live connection status.

### Holder Dashboard

- Connected wallet token balance.
- Estimated holding weight.
- Estimated snapshot balance share.
- Estimated next airdrop amount by epoch.
- Distribution status and transaction links.
- nvdax associated token account status.
- Live updates when a batch lands or fails.

### Receipts Page

Receipt types:

- Pump.fun creator-fee intake.
- Swap execution.
- nvdax vault deposit.
- Snapshot finalized.
- Airdrop manifest finalized.
- Airdrop batch executed.
- Optional fallback claim opened.

Each receipt should display:

- Solana transaction signature.
- Slot/time.
- Input mint and amount.
- Output mint and amount.
- Keeper or distributor identity.
- Vault address.
- Program receipt account.
- Manifest hash or batch hash.
- External proof URL/hash when off-chain services are involved.

The receipt feed should append new records without requiring a page refresh.

### Admin/Keeper Page

This should be gated by wallet permissions.

- Collect available Pump.fun creator fees.
- Run buy cycle.
- Submit receipt.
- Finalize distribution epoch.
- Send airdrop batch.
- Open fallback claim window for failed or dust distributions.
- Pause emergency operations.

## Airdrop Rules

Eligible airdrop share is based on:

- Token balance.
- Time held during the epoch.
- Optional loyalty multiplier for uninterrupted holding.
- Optional cap to reduce whale dominance.
- Exclusions for treasury, LP, burn, team, and known exchange wallets.

Airdrops should use a deterministic distribution manifest so the website, community, and auditors can reproduce the exact recipient list and amounts.

The schedule should start with frequent airdrops and expand exponentially over time:

```text
epoch interval = 3 minutes * 2^epoch_index
holder cap = base holder cap * 2^epoch_index
```

The interval and holder cap keep doubling by epoch unless the admin/governance config changes it.

For failed transfers, dust amounts, or holders with missing nvdax token accounts, the project can either:

- Pay ATA rent and send anyway.
- Skip amounts below a minimum threshold and roll them to the next epoch.
- Put failed recipients into a fallback Merkle claim window.

## Non-Goals For MVP

- Native Bitcoin payouts.
- Complex cross-chain Bitcoin proofs.
- Per-block continuous reward accounting on-chain.
- Market-making or trading strategy optimization.
- Yield strategies with the acquired BTC.

## Live Update Requirements

- Countdown timers tick client-side and reconcile with server/indexer time.
- New receipts append to the feed through WebSocket or Server-Sent Events.
- Holder estimates update when new snapshots or manifests are produced.
- Airdrop status updates when batch transactions confirm or fail.
- UI should show stale/disconnected state if the stream drops.
