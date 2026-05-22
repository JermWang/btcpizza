# Admin Operations

The admin page lives at `/admin` and talks to `/api/admin`.

## Password Gate

Set either `ADMIN_PASSWORD` or `ADMIN_API_TOKEN`. The static admin page keeps the password in `sessionStorage` for the current browser session and sends it to the API as `x-admin-password`. The API refuses every admin request when no admin secret is configured.

For Vercel/mainnet, add the variables from `.env.mainnet.example` to the project environment. At minimum, the live admin page needs `ADMIN_PASSWORD` or `ADMIN_API_TOKEN`, `DATABASE_URL`, `SOLANA_RPC_URL` or `HELIUS_RPC_URL`, and the public wallet/mint values. After changing Vercel env vars, redeploy the project so `/api/admin` receives the new server environment.

## Direct Built-In Actions

These buttons run directly through Solana RPC and do not need third-party credits:

- `Validate Config`: checks admin, RPC, wallet, mint, and action readiness.
- `Refresh Fee Receipts`: reads recent `WALLET` signatures and SOL balance.
- `Refresh Holder List`: scans token accounts for `TOKEN_MINT` through the configured holder provider.
- `Check WBTC Vault`: reads the configured `WALLET` balance for `REWARD_MINT`.
- `Official Live GO`: validates live readiness and arms continuous epochs. Cron performs the actual epoch work after that.
- `Run Due Epoch`: cron/manual tick that only runs when the next displayed epoch time is due.
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

## Continuous Epoch Automation

Confirmed live GO stores an `epoch-automation` record and starts the epoch clock. That is the only admin action required to begin automation. After that, an external cron service calls `/api/cron/epoch-tick` every minute. The endpoint is idempotent: it returns `not_due` until the next displayed epoch end time, then runs the full due epoch and advances `nextEpochIndex`.

The cron runner owns every post-start epoch action:

1. Claim Pump.fun creator fees for the configured wallet.
2. Buy WBTC through Jupiter using the configured signer and spend limit.
3. Read the distributor WBTC pool.
4. Snapshot holders for the configured token mint.
5. Compute proportional payouts.
6. Lock the manifest and prepare the next batch.
7. Send WBTC to payable holders.
8. Record receipts, epoch status, and optional screenshot evidence.

Do not use admin buttons as part of normal epoch operation after `Official Live GO` is armed. Admin remains for setup, emergency pause/retry, and manual diagnostics.

This project does not define Vercel Cron jobs in `vercel.json`. Vercel Hobby cron is limited to daily cadence, while the launch runner needs minute-level checks. Use cronjob.org or another external scheduler instead.

cronjob.org setup:

```text
URL: https://www.btcpizzastrategy.xyz/api/cron/epoch-tick
Method: POST
Headers:
  Content-Type: application/json
  Authorization: Bearer <CRON_SECRET>
Body: { "source": "cron-job.org" }
Schedule: every 1 minute
Expected idle response: {"ok":true,"action":"run-due-epoch","result":{"status":"idle",...}}
Expected armed response before due time: {"ok":true,"action":"run-due-epoch","result":{"status":"not_due",...}}
```

The endpoint also accepts `x-cron-secret: <CRON_SECRET>`. Keep the raw secret out of commits, screenshots, and public cron logs. Do not send `"task":"epoch-tick"` in production cron requests; the cron endpoint now always calls the full due-epoch automation runner.

Each due epoch runs this sequence:

1. Claim Pump.fun creator fees for the configured coin.
2. Refresh fee-wallet receipts.
3. Buy WBTC through Jupiter using the configured cycle spend and signer.
4. Read the distributor WBTC pool.
5. Snapshot holders for `TOKEN_MINT`.
6. Compute proportional payouts using token balance at the epoch snapshot.
7. Lock the manifest, prepare the batch, and distribute WBTC to payable holders.
8. If `ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL` is configured, call it with the dashboard URL and epoch record so a screenshot can be stored.

Required live epoch env:

```env
ADMIN_PASSWORD=...
SOLANA_RPC_URL=...
WALLET=<creator/fee/distributor wallet unless routing overrides are set>
WALLET_PRIVATE_KEY=...
TOKEN_MINT=...
REWARD_MINT=9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E
CRON_SECRET=...
MAX_CYCLE_SPEND_UI_AMOUNT=0.01
# Optional:
ADMIN_EPOCH_SCREENSHOT_WEBHOOK_URL=https://your-screenshot-worker.example/capture
ADMIN_EPOCH_SCREENSHOT_URL=https://your-production-site.example
CREATOR_FEE_DRY_RUN=false
DISTRIBUTOR_DRY_RUN=false
```

The default routing is intentionally simple: `WALLET` receives/controls fees, swaps, and WBTC distribution, and `WALLET_PRIVATE_KEY` signs those live actions. Only set `CREATOR_*`, `JUPITER_SWAP_*`, or `DISTRIBUTOR_*` overrides if those responsibilities are intentionally split across different wallets.

The screenshot webhook receives:

```json
{
  "targetUrl": "https://your-production-site.example",
  "epoch": {
    "epochIndex": 0,
    "status": "confirmed",
    "manifestId": "...",
    "batchId": "...",
    "signature": "..."
  },
  "requestedAt": "2026-05-22T00:00:00.000Z"
}
```

Return JSON with `screenshotUrl`, `imageUrl`, `url`, or `assetUrl`. The admin storage records that URL on the epoch and automation state.

For direct holder snapshots through an indexed RPC, set:

```env
HOLDER_SNAPSHOT_PROVIDER=helius
ENABLE_RPC_HOLDER_FALLBACK=true
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
TOKEN_MINT=...
SOLANA_RPC_URL=...
```

Use a paid or dedicated Solana RPC for large holder lists. Public RPC nodes may reject or throttle `getProgramAccounts`, and many do not expose Token-2022 account indexes.

For Pump.fun / Token-2022 mints, the safer production setup is:

```env
HOLDER_SNAPSHOT_PROVIDER=helius
HELIUS_API_KEY=...
TOKEN_MINT=...
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

Use `Preview WBTC Buy` first. It calls Jupiter `/quote` with `inputMint=So11111111111111111111111111111111111111112` and `outputMint=REWARD_MINT`. That input mint is Solana WSOL, which Jupiter also uses for native SOL routes.

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

Default env:

```env
WALLET=<creator/dev wallet public key>
WALLET_PRIVATE_KEY=...
CREATOR_FEE_DRY_RUN=false
CREATOR_FEE_PRIORITY_FEE_SOL=0.000001
CREATOR_FEE_POOL=pump
PUMPPORTAL_LOCAL_API_URL=https://pumpportal.fun/api/trade-local
```

Do not paste private keys into chat. `WALLET_PRIVATE_KEY` is the default signer. Use `CREATOR_KEYPAIR_PATH` or `CREATOR_PRIVATE_KEY_BASE58` only if fee claiming is intentionally routed to a different creator wallet.

For Pump.fun claims, PumpPortal notes that creator fees are claimed all at once and `mint` is not required. For Meteora DBC claims, pass `pool=meteora-dbc` and `mint=<token mint>` in the admin payload.

## Direct WBTC Airdrops

The distributor button now runs inside this repo. It reads the latest prepared batch, derives each recipient's WBTC associated token account, creates ATAs idempotently when `CREATE_RECIPIENT_ATAS=true`, and sends SPL Token `TransferChecked` instructions.

Default live-send env:

```env
SOLANA_RPC_URL=...
WALLET=<must match distribution signer public key unless routing overrides are set>
WALLET_PRIVATE_KEY=...
REWARD_MINT=9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E
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

Manual admin actions are diagnostics and emergency controls, not the normal epoch path:

```text
Claim Fees -> Buy WBTC -> Snapshot Holders -> Lock Snapshot -> Simulate Distribution -> Execute Distribution -> Verify Results
```

The `Official Live GO` control only validates setup and arms automation. With `Dry run` off and `Confirm live` enabled, it does not claim fees, buy WBTC, snapshot holders, lock manifests, generate batches, or send WBTC. Cron owns those steps after the first epoch is started.

Launch arming is manual-only. `PUBLIC_DISTRIBUTION_STARTED_AT` is display and schedule metadata for the public dashboard; setting that timestamp does not claim fees, buy WBTC, create snapshots, lock manifests, or send distributions. The live epoch sequence runs from cron after pressing `Official Live GO` with `Dry run` off and `Confirm live` enabled.

Use the payload builder for values that should travel with the next action:

- `rewardPoolWbtc`: WBTC amount to allocate in simulation or distribution.
- `minPayout`: dust threshold below which recipients are skipped.
- `batchSize`: max recipients per distribution batch.
- `roundCap`: max ranked holders included in the run. The effective eligible count is always capped at the current total holder count.
- `slippageBps`: maximum swap slippage sent to buy/quote webhooks.
- `snapshotId`: locked manifest/snapshot identifier when your distributor requires one.

The browser-side audit log is session-local and exportable as CSV. Production webhooks or distributor services should still write their own append-only server-side audit records because browser storage is not a durable compliance log.
