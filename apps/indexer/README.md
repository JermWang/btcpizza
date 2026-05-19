# Indexer

TypeScript worker for receipts, Pump.fun creator-fee treasury inflows, holder snapshots, score calculation, distribution manifests, and fallback claim artifacts.

## Responsibilities

- Watch fee vault program accounts.
- Normalize receipt records into Postgres.
- Track Pump.fun creator-fee treasury inflows.
- Track project token holder balances.
- Generate deterministic epoch snapshots.
- Build distribution manifests.
- Build optional Merkle roots and per-holder proofs for fallback claims.
- Publish snapshot and manifest artifact hashes.

## Suggested Modules

- `src/solana/client.ts`
- `src/receipts/ingest.ts`
- `src/pumpfun/treasury.ts`
- `src/holders/snapshots.ts`
- `src/airdrop/score.ts`
- `src/airdrop/manifest.ts`
- `src/claims/fallback-merkle.ts`
- `src/api/server.ts`
