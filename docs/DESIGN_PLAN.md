# Design Plan

## Direction

The site should feel like a pixel-art pizza parlor dashboard, not a literal game screen. The parlor is the visual metaphor; the product is still a public DeFi dashboard for Pump.fun creator fees, WBTC acquisition, holder scoring, receipts, and airdrop batches.

## Visual References

Use the user's references as direction:

- Chunky pixel pizza slice.
- Playful `Pizza Pit`-style logo energy.
- Simple 90s title-screen clarity.
- Pixel parlor interior/storefront atmosphere.

Do not copy the references directly. Use them to guide shape language, typography weight, color blocking, and mood.

## Visual Principles

- Storefront first: make the first viewport feel like an actual pizza parlor.
- Dashboard always visible: users immediately understand what the site does.
- Gamified through art direction, not fake game mechanics.
- Short copy only. Use labels, tickets, menu boards, and receipts.
- Financial information stays crisp and easy to scan.

## First View

- Pixel-art `Pizza Pit`-style brand mark.
- Pizza parlor storefront or counter scene.
- Clear headline: `Public WBTC airdrop dashboard.`
- Short explanation: Pump.fun creator fees -> WBTC -> holder airdrops.
- Live stats: WBTC pool, next slice, recipients, live status.
- Pixel-style CTA buttons.

## Core Modules

- Pizza Pool: live WBTC amount and slice visualization.
- Next Slice: countdown, epoch, and current interval.
- Order Flow: Fees, Swap, List, Drop.
- Your Ticket: holder score, estimated WBTC, WBTC ATA status.
- Receipt Tickets: fee intake, swap, manifest, batch events.
- Slice Strip: expanding cadence from 3m through 1h+.

## Art Direction

- 90s pizza game title-screen energy.
- Pixel storefront with awning, sign, window, counter, pizza case.
- Chunky black outlines.
- Bright sky/storefront color blocking.
- Warm cheese/sauce/crust colors.
- Mint/cyan only for live DeFi confirmations.
- No large paragraphs.

## Image Generation

Use GPT Image 2 for visual development and final raster assets:

- Pixel-art pizza parlor storefront hero.
- `Pizza Pit`-inspired original logo direction.
- Pixel pizza slice icon.
- Pizza counter / display case scene.
- Social card.

Use code-native UI for:

- Live stats.
- Receipt rows.
- Holder data.
- Countdown.
- Slice cadence.

## Live Behavior

- Countdown ticks every second.
- WBTC pool updates without refresh.
- Receipt tickets append without refresh.
- Slice cadence updates as epochs advance.
- Holder estimate updates after new manifests.

## UX Tone

Good:

- `Pump fees in. WBTC slices out.`
- `Next slice`
- `Pizza pool`
- `Receipt tickets`
- `Order flow`
- `WBTC slice served`

Avoid:

- `Passive income`
- `Yield`
- `Guaranteed rewards`
- Long educational paragraphs in the UI

## Local Preview

The current preview lives at:

```text
preview/index.html
```

Run it with:

```text
node server.mjs
```

from the `preview` directory, then open:

```text
http://localhost:4173
```
