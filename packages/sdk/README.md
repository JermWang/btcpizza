# SDK

Shared TypeScript client for the web app, keeper, distributor, tests, and indexer.

## Responsibilities

- Program ID and IDL exports.
- Typed account fetch helpers.
- Instruction builders.
- Receipt decoding.
- Distribution manifest helpers.
- Airdrop batch helpers.
- Optional fallback claim proof helpers.
- Formatting helpers for dashboard amounts.

## Suggested Modules

- `src/program.ts`
- `src/accounts.ts`
- `src/instructions.ts`
- `src/receipts.ts`
- `src/airdrop.ts`
- `src/fallback-claims.ts`
- `src/format.ts`
