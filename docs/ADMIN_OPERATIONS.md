# Admin Operations

The admin page lives at `/admin` and talks to `/api/admin`.

## Password Gate

Set either `ADMIN_PASSWORD` or `ADMIN_API_TOKEN`. The static admin page keeps the password in `sessionStorage` for the current browser session and sends it to the API as `x-admin-password`. The API refuses every admin request when no admin secret is configured.

For Vercel/mainnet, add the variables from `.env.mainnet.example` to the project environment. At minimum, the live admin page needs `ADMIN_PASSWORD` or `ADMIN_API_TOKEN`, `DATABASE_URL`, `SOLANA_RPC_URL` or `HELIUS_RPC_URL`, and the public wallet/mint values. After changing Vercel env vars, redeploy the project so `/api/admin` receives the new server environment.

## Direct Built-In Actions

These buttons run directly through Solana RPC and do not need third-party credits:

- `Validate Config`: checks admin, RPC, wallet, mint, and action readiness.
- `Refresh Fee Receipts`: reads recent `PUBLIC_FEE_WALLET` signatures and SOL balance.
- `Refresh Holder List`: scans token accounts for `PUBLIC_TOKEN_MINT` through the configured holder provider.
- `Check WBTC Vault`: reads the configured `PUBLIC_DISTRIBUTOR_WALLET` balance for `PUBLIC_WBTC_MINT`.
- `Official Live GO`: dry-runs launch readiness, or in live-confirmed mode creates the holder snapshot, locks the manifest, prepares the next batch, and executes the WBTC send.
- `Create Holder Snapshot`: same holder-source path as refresh, exposed in the snapshot workflow.
- `Simulate Distribution`: computes holder weights, dust skips, payout estimates, and batch count without sending WBTC.
- `Publish Receipt`: stores a durable local receipt record when no receipt webhook is configured.
- `Lock Snapshot`: stores a locked manifest with a deterministic manifest hash.
- `Generate Batch`: stores an idempotent prepared batch from the locked manifest.
- `Execute WBTC Batch`: signs and submits SPL Token WBTC transfers from `DISTRIBUTOR_KEYPAIR_PATH` when dry-run is disabled.
- `Retry Failed Sends`: reruns the latest prepared/failed WBTC batch, with duplicate-confirmed protection.
- `Preview WBTC Buy`: quotes SOL -> WBTC through Jupiter.
- `Approve Swap Spend`: direct no-op on Solana because Jupiter swaps are authorized by signing the transaction.
- `Buy WBTC`: builds an unsigned Jupiter swap transaction for the configured signer to sign and submit.
- `Simulate Fee Claim`: builds the PumpPortal `collectCreatorFee` transaction locally without signing.
- `Claim Creator Fees`: signs and submits the PumpPortal `collectCreatorFee` transaction with `CREATOR_KEYPAIR_PATH` when dry-run is disabled.

For direct holder snapshots through an indexed RPC, set:

```env
HOLDER_SNAPSHOT_PROVIDER=helius
ENABLE_RPC_HOLDER_FALLBACK=true
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
PUBLIC_TOKEN_MINT=...
SOLANA_RPC_URL=...
```

Use a paid or dedicated Solana RPC for large holder lists. Public RPC nodes may reject or throttle `getProgramAccounts`, and many do not expose Token-2022 account indexes.

For Pump.fun / Token-2022 mints, the safer production setup is:

```env
HOLDER_SNAPSHOT_PROVIDER=helius
HELIUS_API_KEY=...
PUBLIC_TOKEN_MINT=...
SOLANA_RPC_URL=...
```

The Helius path uses `getTokenAccounts` pagination, merges multiple token accounts owned by the same wallet, and keeps `SOLANA_RPC_URL` for mint/supply reads.

Before using a snapshot for rewards, exclude LP, pool, treasury, deployer, fee, burn, and operational wallets. The scanner reports excluded accounts separately and excludes any wallet at or above `HOLDER_MAX_SUPPLY_PERCENT` by default. For Pump-style launches, `20` is the default because wallets above roughly 20% are usually LP, bonding curve, migration, treasury, or other control accounts:

```env
HOLDER_MAX_SUPPLY_PERCENT=20
HOLDER_EXCLUDED_POOL_WALLETS=<known LP/pool owners>
HOLDER_EXCLUDED_WALLETS=<treasury, deployer, fee, distributor, burn, team wallets>
```

Do not treat the largest token-account owner as a human holder until you identify whether it is a pool, bonding curve, migration vault, treasury, or burn/control account.

## Webhook Actions

Live signing operations are webhook-backed until the keeper and distributor are implemented inside this repo. Each webhook receives:

```json
{
  "action": "distribute-wbtc",
  "dryRun": true,
  "requestedAt": "2026-05-21T00:00:00.000Z",
  "payload": {}
}
```

If `ADMIN_ACTION_WEBHOOK_SECRET` is set, the request includes both `Authorization: Bearer <secret>` and `x-admin-action-secret: <secret>`.

Configure a shared `ADMIN_ACTION_WEBHOOK_URL`, or per-action URLs:

- `ADMIN_SYNC_INDEXER_WEBHOOK_URL`
- `ADMIN_SIMULATE_CLAIM_CREATOR_FEES_WEBHOOK_URL`
- `ADMIN_CLAIM_CREATOR_FEES_WEBHOOK_URL`
- `ADMIN_QUOTE_WBTC_BUY_WEBHOOK_URL`
- `ADMIN_APPROVE_WBTC_BUY_WEBHOOK_URL`
- `ADMIN_EXECUTE_WBTC_BUY_WEBHOOK_URL`
- `ADMIN_RECORD_RECEIPT_WEBHOOK_URL`
- `ADMIN_CREATE_HOLDER_SNAPSHOT_WEBHOOK_URL`
- `ADMIN_FINALIZE_MANIFEST_WEBHOOK_URL`
- `ADMIN_GENERATE_DISTRIBUTION_BATCH_WEBHOOK_URL`
- `ADMIN_DISTRIBUTE_WBTC_WEBHOOK_URL`
- `ADMIN_RETRY_FAILED_AIRDROPS_WEBHOOK_URL`
- `ADMIN_OPEN_FALLBACK_CLAIMS_WEBHOOK_URL`
- `ADMIN_CLOSE_FALLBACK_CLAIMS_WEBHOOK_URL`
- `ADMIN_PAUSE_PROTOCOL_WEBHOOK_URL`
- `ADMIN_UNPAUSE_PROTOCOL_WEBHOOK_URL`

Dangerous actions require the admin page's `Confirm live actions` toggle. Keep `Dry run` enabled when testing webhooks.

## Jupiter WBTC Buy Setup

The admin console uses Jupiter by default for SOL -> WBTC routing:

```env
JUPITER_API_BASE_URL=https://api.jup.ag/swap/v1
JUPITER_API_KEY=
JUPITER_SWAP_USER_PUBLIC_KEY=
MAX_CYCLE_SPEND_UI_AMOUNT=0.01
MAX_SLIPPAGE_BPS=100
```

Use `Preview WBTC Buy` first. It calls Jupiter `/quote` with `inputMint=So11111111111111111111111111111111111111112` and `outputMint=PUBLIC_WBTC_MINT`. That input mint is Solana WSOL, which Jupiter also uses for native SOL routes.

Use `Buy WBTC` to build an unsigned Jupiter `/swap` transaction. The dashboard does not sign the transaction; your keeper, wallet, Squads signer, or custody service must sign and submit the returned `swapTransaction`.

If your creator fees are already sitting in a WSOL token account, use:

```env
JUPITER_INPUT_SOURCE=wsol
JUPITER_WRAP_AND_UNWRAP_SOL=false
```

If the fees are native SOL, use:

```env
JUPITER_INPUT_SOURCE=sol
JUPITER_WRAP_AND_UNWRAP_SOL=true
```

On Solana there is no ERC-20-style approval step for the standard SOL/WSOL -> WBTC Jupiter flow, so `Approve Swap Spend` records `not_required`.

## Creator Fee Claim Setup

Creator-fee claiming uses PumpPortal's local transaction API with `action=collectCreatorFee`. The API returns an unsigned Solana versioned transaction; this repo signs and submits it locally when dry-run is disabled.

Research references:

- Pump.fun's own fees page documents creator fees as the portion of trade fees paid to the token creator.
- PumpPortal documents `collectCreatorFee` through `https://pumpportal.fun/api/trade-local`.

Recommended env:

```env
DEV_CREATOR_WALLET=<creator/dev wallet public key>
CREATOR_KEYPAIR_PATH=C:\secure\bitcoin-pizza-strategy-creator.json
CREATOR_FEE_DRY_RUN=false
CREATOR_FEE_PRIORITY_FEE_SOL=0.000001
CREATOR_FEE_POOL=pump
PUMPPORTAL_LOCAL_API_URL=https://pumpportal.fun/api/trade-local
```

Do not paste private keys into chat. Put the creator wallet keypair in a local file and point `CREATOR_KEYPAIR_PATH` at it. `CREATOR_PRIVATE_KEY_BASE58` exists for emergency local testing only; prefer the file path.

For Pump.fun claims, PumpPortal notes that creator fees are claimed all at once and `mint` is not required. For Meteora DBC claims, pass `pool=meteora-dbc` and `mint=<token mint>` in the admin payload.

## Direct WBTC Airdrops

The distributor button now runs inside this repo. It reads the latest prepared batch, derives each recipient's WBTC associated token account, creates ATAs idempotently when `CREATE_RECIPIENT_ATAS=true`, and sends SPL Token `TransferChecked` instructions.

Required live-send env:

```env
SOLANA_RPC_URL=...
PUBLIC_DISTRIBUTOR_WALLET=<must match distributor keypair public key>
PUBLIC_WBTC_MINT=9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E
DISTRIBUTOR_KEYPAIR_PATH=C:\secure\bitcoin-pizza-strategy-distributor.json
DISTRIBUTOR_DRY_RUN=false
CREATE_RECIPIENT_ATAS=true
MAX_RECIPIENTS_PER_BATCH=4
```

Recommended first live test:

1. Keep the admin UI `Dry run` toggle enabled.
2. Lock a tiny manifest and generate a batch of `1`.
3. Click `Execute WBTC Batch`; confirm it builds the transfer transaction.
4. Disable the UI `Dry run` toggle, enable `Confirm live`, and execute a one-recipient batch.
5. Confirm the saved receipt signature on Solscan.

Use small `MAX_RECIPIENTS_PER_BATCH` values first because creating recipient ATAs and transferring in the same transaction can exceed Solana transaction size if the batch is too large.

## Durable Admin Storage

For production, set `DATABASE_URL` to a Neon/Postgres connection string. The Vercel/Neon aliases `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, and `POSTGRES_URL_NON_POOLING` are also accepted. The admin backend creates these tables automatically on first use:

```sql
admin_records
admin_audit_events
```

When `DATABASE_URL` is set, snapshots, locked manifests, prepared batches, receipts, and audit events persist in Postgres. The admin status response reports `storage.backend = "postgres"` so operators can confirm the durable path is active.

Without `DATABASE_URL`, the admin server writes append-only audit entries plus JSON records for receipts, snapshots, manifests, and batches under:

```env
ADMIN_STORAGE_PATH=./.admin-data
```

This is enough for local demo and operational proof, and it prevents accidental duplicate manifest/batch preparation by hashing the locked manifest and batch window. For production deployment, use `DATABASE_URL` so Vercel serverless restarts do not lose launch state.

Stored objects:

- `audit-log.jsonl`: every admin action start/completion.
- `snapshots/*.json`: holder snapshot records.
- `manifests/*.json`: locked distribution manifests with `manifestHash`.
- `batches/*.json`: prepared transfer batches with `batchHash`.
- `receipts/*.json`: manual or webhook-backed proof records.

## Admin Console Workflow

The dashboard is organized around the manual operator flow:

```text
Claim Fees -> Buy WBTC -> Snapshot Holders -> Lock Snapshot -> Simulate Distribution -> Execute Distribution -> Verify Results
```

The `Official Live GO` control uses that same backend wiring for the airdrop leg. Keep `Dry run` enabled first; it checks config, fee receipts, WBTC vault, holders, and payout math. With `Dry run` off and `Confirm live` enabled, it uses the reward pool from the payload builder, or the current distributor WBTC balance when the field is empty, then locks the snapshot, generates the batch, and sends WBTC. Add `"executeDistribution": false` in the raw JSON payload if you want it to stop after preparing the batch.

Launch execution is manual-only. `PUBLIC_DISTRIBUTION_STARTED_AT` is display and schedule metadata for the public dashboard; setting that timestamp does not claim fees, buy WBTC, create snapshots, lock manifests, or send distributions. The live launch sequence only runs from the admin dashboard after pressing `Official Live GO` with `Dry run` off and `Confirm live` enabled.

Use the payload builder for values that should travel with the next action:

- `rewardPoolWbtc`: WBTC amount to allocate in simulation or distribution.
- `minPayout`: dust threshold below which recipients are skipped.
- `batchSize`: max recipients per distribution batch.
- `roundCap`: max ranked holders included in the run. The effective eligible count is always capped at the current total holder count.
- `slippageBps`: maximum swap slippage sent to buy/quote webhooks.
- `snapshotId`: locked manifest/snapshot identifier when your distributor requires one.

The browser-side audit log is session-local and exportable as CSV. Production webhooks or distributor services should still write their own append-only server-side audit records because browser storage is not a durable compliance log.
