# Security And Legal Notes

## Security Risks

- Keeper key compromise.
- Distributor key compromise.
- Incorrect Pump.fun creator-fee owner or treasury configuration.
- Swap slippage or sandwiching.
- Snapshot manipulation.
- Distribution manifest generation bugs.
- Duplicate or skipped airdrop rows.
- ATA creation costs exceeding reward value.
- Vault drain from bad fallback claim verification.
- Mismatch between displayed receipts and actual token balances.
- Wrapped BTC bridge/custodian risk.

## Controls

- Use multisig for admin authorities where practical.
- Minimize upgrade authority or use timelock governance.
- Limit keeper and distributor hot-wallet balances.
- Keep vault transfer authority inside the program or multisig where practical.
- Add a pause mechanism.
- Enforce max slippage and max spend per cycle.
- Enforce minimum airdrop thresholds.
- Store receipt accounts on-chain and render them directly in the dashboard.
- Publish snapshot files, distribution manifests, and deterministic generation code.
- Make airdrop batch execution idempotent.
- Run independent smart contract audit before holding meaningful value.

## Legal/Compliance Risks

Automatic WBTC airdrops funded by creator fees can resemble revenue sharing, dividends, or investment returns if marketed poorly. That creates securities, tax, and consumer protection risk depending on jurisdiction.

Safer language:

- "Transparent fee recycling."
- "Promotional WBTC airdrops."
- "BTC exposure acquired by the project."
- "Conditional community rewards."

Riskier language:

- "Passive income."
- "Dividends."
- "Guaranteed yield."
- "Profit share."
- "Earn BTC forever."

Before launch, get legal review on:

- Holder reward mechanics.
- Automatic airdrop mechanics.
- Wrapped BTC custody and bridge risk disclosures.
- Tax reporting.
- Marketing copy.
- Geographic restrictions.

## Operational Transparency

The project should publish:

- Pump.fun coin address.
- Creator-fee owner wallet.
- Treasury addresses.
- Keeper addresses.
- Distributor addresses.
- Swap transaction signatures.
- WBTC vault address.
- Distribution manifest hashes.
- Airdrop batch transaction signatures.
- Snapshot source files.
- Known excluded wallets.
