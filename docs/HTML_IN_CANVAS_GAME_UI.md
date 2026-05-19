# HTML-In-Canvas Game UI Plan

## Product Fantasy

BTC Pizza Shop: a 90s console-style DeFi game where each utility function is a pizza shop station.

## Architecture

- Canvas owns the immersive playfield.
- HTML owns readable controls and financial data.
- Shared app state drives both layers.

This keeps the game feel while preserving dashboard clarity.

## Canvas Layer

Render:

- Low-poly pizza shop.
- Oven / pizza pool.
- BTC coin.
- Utility stations.
- Active slice glow.
- Camera shift and ambient motion.

Canvas should not render long financial text.

## HTML Layer

Render:

- Countdown.
- Current interval.
- Epoch.
- Pool WBTC.
- Creator fees.
- Recipient count.
- Holder score.
- Estimated WBTC.
- Receipt feed.
- Utility station buttons.

## Utility Stations

- Fees: Pump.fun creator fee intake.
- Swap: SOL/fee asset to WBTC.
- Manifest: holder scoring and manifest hash.
- Airdrop: batched WBTC transfers.

## Interaction Model

- `Bake Next Drop`: advances one airdrop epoch.
- `Add Receipt`: simulates a streamed receipt.
- `Shift Camera`: changes the canvas view.
- Station buttons change the highlighted station.

## Visual Rules

- Low-poly, 64-bit-console-inspired geometry.
- Pixelated canvas rendering.
- Short labels only.
- No large paragraph blocks in the app UI.
- Warm pizza colors for emotion.
- Mint/cyan for live DeFi states.
- Gold for WBTC/BTC value.

## Production Notes

For production, replace simulated state with:

- Solana RPC/account subscriptions.
- Indexer WebSocket or SSE stream.
- Real receipt rows.
- Real holder score estimates.
- Real airdrop manifest and batch status.

