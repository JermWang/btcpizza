# Distributor

Batch sender for automatic wrapped-BTC airdrops.

## Responsibilities

- Load finalized distribution manifests.
- Validate manifest hash against the on-chain receipt/program account.
- Create recipient wrapped-BTC associated token accounts when policy allows.
- Send bounded SPL-token transfer batches.
- Record every batch transaction signature.
- Retry failed transfers.
- Produce fallback recipient manifests.

## Distribution Policy

The distributor must support:

- Minimum payout threshold.
- Maximum recipients per transaction.
- Maximum WBTC per batch.
- ATA creation enabled/disabled.
- Retry count.
- Rollover or fallback-claim behavior for failed recipients.

## Idempotency

Each manifest row should have a stable id:

```text
row_id = sha256(epoch || wallet || amount || token_account)
```

The distributor should persist row status before and after transaction confirmation so interrupted runs can resume safely.
