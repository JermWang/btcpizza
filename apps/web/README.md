# Web App

Next.js dashboard for holders, receipts, airdrop verification, and operator actions.

## Required Views

- `/`: public dashboard.
- `/receipts`: creator-fee, swap, manifest, and airdrop receipt feed.
- `/airdrop`: holder airdrop verification UI.
- `/fallback-claim`: optional fallback claim UI for failed/dust distributions.
- `/admin`: gated keeper/distributor console.

## Data Sources

- Solana program accounts via `packages/sdk`.
- Indexed receipt and manifest API from `apps/indexer`.
- Wallet balance reads from Solana RPC.
- nvdax associated token account status.

## UX Requirements

- Every metric links to a transaction signature, manifest hash, or program account.
- Airdrop rows must show epoch, score, amount, batch transaction, and delivery status.
- Fallback claim amounts must show epoch, Merkle root, and proof status.
- Admin actions must show dry-run preview before signing.
- Countdown timers must use server time where possible.
