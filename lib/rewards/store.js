const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { databaseConfigured, postgresPoolConfig } = require("../database");

let schemaReady = false;

function pool() {
  if (!globalThis.__btcPizzaRewardsPgPool) {
    const { Pool } = require("pg");
    globalThis.__btcPizzaRewardsPgPool = new Pool(postgresPoolConfig());
  }
  return globalThis.__btcPizzaRewardsPgPool;
}

function localRoot() {
  return path.join(process.env.ADMIN_STORAGE_PATH ? path.resolve(process.env.ADMIN_STORAGE_PATH) : path.join(os.tmpdir(), "jensen-strategy-admin-data"), "rewards");
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

async function ensureRewardSchema() {
  if (!databaseConfigured() || schemaReady) return;
  await pool().query(`
    create extension if not exists pgcrypto;
    create table if not exists reward_epochs (
      id uuid primary key default gen_random_uuid(),
      epoch_index integer unique not null,
      status text not null,
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      interval_seconds integer not null,
      holder_cap integer not null default 5,
      token_mint text not null,
      reward_mint text not null,
      fee_wallet text,
      treasury_wallet text,
      total_holder_balance_raw text not null default '0',
      total_reward_pool_raw text not null default '0',
      distributable_reward_raw text not null default '0',
      distributed_reward_raw text not null default '0',
      leftover_reward_raw text not null default '0',
      manifest_hash text,
      snapshot_slot bigint,
      snapshot_status text not null default 'snapshot_pending',
      snapshot_started_at timestamptz,
      snapshot_completed_at timestamptz,
      snapshot_source text,
      snapshot_error text,
      last_rpc_success_at timestamptz,
      last_rpc_failure_at timestamptz,
      rpc_failure_count integer not null default 0,
      served_from_cache boolean not null default false,
      started_processing_at timestamptz,
      completed_at timestamptz,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists reward_epochs_status_idx on reward_epochs (status, ends_at);

    create table if not exists reward_epoch_holders (
      id uuid primary key default gen_random_uuid(),
      epoch_id uuid references reward_epochs(id) on delete cascade,
      owner_wallet text not null,
      token_account text,
      balance_raw text not null,
      balance_ui text,
      weight text not null,
      reward_raw text not null,
      reward_ui text,
      rank integer not null,
      eligible boolean not null default true,
      in_holder_cap boolean not null default false,
      ata_address text,
      ata_exists boolean default false,
      transfer_status text not null default 'pending',
      transfer_signature text,
      transfer_error text,
      created_at timestamptz not null default now(),
      unique (epoch_id, owner_wallet)
    );
    create index if not exists reward_epoch_holders_epoch_rank_idx on reward_epoch_holders (epoch_id, rank);

    create table if not exists reward_epoch_batches (
      id uuid primary key default gen_random_uuid(),
      epoch_id uuid references reward_epochs(id) on delete cascade,
      batch_index integer not null,
      status text not null default 'pending',
      transfer_count integer not null default 0,
      total_reward_raw text not null default '0',
      signature text,
      error text,
      attempted_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      unique (epoch_id, batch_index)
    );

    create table if not exists reward_receipts (
      id uuid primary key default gen_random_uuid(),
      epoch_id uuid references reward_epochs(id) on delete cascade,
      batch_id uuid references reward_epoch_batches(id) on delete set null,
      recipient_wallet text not null,
      reward_mint text not null,
      amount_raw text not null,
      amount_ui text,
      signature text,
      solscan_url text,
      status text not null,
      created_at timestamptz not null default now()
    );

    create table if not exists reward_engine_locks (
      lock_key text primary key,
      locked_until timestamptz not null,
      locked_by text not null,
      updated_at timestamptz not null default now()
    );

    create table if not exists dashboard_cache (
      cache_key text primary key,
      payload jsonb not null,
      generated_at timestamptz not null,
      expires_at timestamptz,
      stale_after timestamptz,
      source_epoch_id uuid
    );
  `);
  schemaReady = true;
}

function readLocal() {
  const file = path.join(localRoot(), "store.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { epochs: [], holders: [], batches: [], receipts: [], locks: {}, cache: {} };
  }
}

function writeLocal(data) {
  fs.mkdirSync(localRoot(), { recursive: true });
  fs.writeFileSync(path.join(localRoot(), "store.json"), `${JSON.stringify(data, null, 2)}\n`);
}

function rowToCamel(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}

async function query(text, params = []) {
  await ensureRewardSchema();
  return await pool().query(text, params);
}

async function acquireLock(lockKey, lockedBy, ttlSeconds) {
  if (databaseConfigured()) {
    await ensureRewardSchema();
    const result = await pool().query(
      `
        insert into reward_engine_locks (lock_key, locked_until, locked_by, updated_at)
        values ($1, now() + ($3::text || ' seconds')::interval, $2, now())
        on conflict (lock_key) do update set
          locked_until = excluded.locked_until,
          locked_by = excluded.locked_by,
          updated_at = now()
        where reward_engine_locks.locked_until < now()
        returning *
      `,
      [lockKey, lockedBy, ttlSeconds]
    );
    return Boolean(result.rows[0]);
  }

  const data = readLocal();
  const now = Date.now();
  const existing = data.locks[lockKey];
  if (existing && Date.parse(existing.lockedUntil) > now) return false;
  data.locks[lockKey] = {
    lockKey,
    lockedBy,
    lockedUntil: new Date(now + ttlSeconds * 1000).toISOString(),
    updatedAt: nowIso()
  };
  writeLocal(data);
  return true;
}

async function releaseLock(lockKey, lockedBy) {
  if (databaseConfigured()) {
    await ensureRewardSchema();
    await pool().query("delete from reward_engine_locks where lock_key = $1 and locked_by = $2", [lockKey, lockedBy]);
    return;
  }
  const data = readLocal();
  if (data.locks[lockKey]?.lockedBy === lockedBy) delete data.locks[lockKey];
  writeLocal(data);
}

async function createEpoch(epoch) {
  if (databaseConfigured()) {
    const result = await query(
      `
        insert into reward_epochs (
          epoch_index, status, starts_at, ends_at, interval_seconds, holder_cap, token_mint, reward_mint,
          fee_wallet, treasury_wallet
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (epoch_index) do update set updated_at = reward_epochs.updated_at
        returning *
      `,
      [
        epoch.epochIndex,
        epoch.status,
        epoch.startsAt,
        epoch.endsAt,
        epoch.intervalSeconds,
        epoch.holderCap,
        epoch.tokenMint,
        epoch.rewardMint,
        epoch.feeWallet,
        epoch.treasuryWallet
      ]
    );
    return result.rows[0];
  }

  const data = readLocal();
  const existing = data.epochs.find((row) => row.epoch_index === epoch.epochIndex);
  if (existing) return existing;
  const row = {
    id: uuid(),
    epoch_index: epoch.epochIndex,
    status: epoch.status,
    starts_at: epoch.startsAt,
    ends_at: epoch.endsAt,
    interval_seconds: epoch.intervalSeconds,
    holder_cap: epoch.holderCap,
    token_mint: epoch.tokenMint,
    reward_mint: epoch.rewardMint,
    fee_wallet: epoch.feeWallet,
    treasury_wallet: epoch.treasuryWallet,
    total_holder_balance_raw: "0",
    total_reward_pool_raw: "0",
    distributable_reward_raw: "0",
    distributed_reward_raw: "0",
    leftover_reward_raw: "0",
    snapshot_status: "snapshot_pending",
    created_at: nowIso(),
    updated_at: nowIso()
  };
  data.epochs.push(row);
  writeLocal(data);
  return row;
}

async function latestEpoch() {
  if (databaseConfigured()) {
    const result = await query("select * from reward_epochs order by epoch_index desc limit 1");
    return result.rows[0] || null;
  }
  return readLocal().epochs.sort((a, b) => b.epoch_index - a.epoch_index)[0] || null;
}

async function latestSnapshottedEpoch() {
  if (databaseConfigured()) {
    const result = await query(
      "select * from reward_epochs where snapshot_status = 'snapshot_completed' order by epoch_index desc limit 1"
    );
    return result.rows[0] || null;
  }
  return readLocal().epochs
    .filter((e) => e.snapshot_status === "snapshot_completed")
    .sort((a, b) => b.epoch_index - a.epoch_index)[0] || null;
}

async function currentEpoch() {
  if (databaseConfigured()) {
    const result = await query(
      `
        select * from reward_epochs
        order by case when status in ('scheduled','snapshotting','distributing','failed') then 0 else 1 end, epoch_index desc
        limit 1
      `
    );
    return result.rows[0] || null;
  }
  return readLocal().epochs.sort((a, b) => {
    const activeA = ["scheduled", "snapshotting", "distributing", "failed"].includes(a.status) ? 0 : 1;
    const activeB = ["scheduled", "snapshotting", "distributing", "failed"].includes(b.status) ? 0 : 1;
    return activeA - activeB || b.epoch_index - a.epoch_index;
  })[0] || null;
}

async function updateEpoch(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (databaseConfigured()) {
    const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
    const values = entries.map(([, value]) => value);
    const result = await query(`update reward_epochs set ${sets}, updated_at = now() where id = $1 returning *`, [id, ...values]);
    return result.rows[0] || null;
  }
  const data = readLocal();
  const row = data.epochs.find((epoch) => epoch.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updated_at: nowIso() });
  writeLocal(data);
  return row;
}

async function upsertHolderRows(epochId, rows) {
  if (databaseConfigured()) {
    await ensureRewardSchema();
    for (const row of rows) {
      await pool().query(
        `
          insert into reward_epoch_holders (
            epoch_id, owner_wallet, token_account, balance_raw, balance_ui, weight, reward_raw, reward_ui, rank,
            eligible, in_holder_cap, ata_address, ata_exists, transfer_status
          )
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14,'pending'))
          on conflict (epoch_id, owner_wallet) do update set
            token_account = excluded.token_account,
            balance_raw = excluded.balance_raw,
            balance_ui = excluded.balance_ui,
            weight = excluded.weight,
            reward_raw = excluded.reward_raw,
            reward_ui = excluded.reward_ui,
            rank = excluded.rank,
            eligible = excluded.eligible,
            in_holder_cap = excluded.in_holder_cap
        `,
        [
          epochId,
          row.wallet,
          row.tokenAccount || "",
          row.balanceRaw,
          row.balanceUi == null ? null : String(row.balanceUi),
          row.weight,
          row.rewardRaw,
          row.rewardUi,
          row.rank,
          row.eligible !== false,
          row.inHolderCap,
          row.ataAddress || null,
          row.ataExists || false,
          row.transferStatus || "pending"
        ]
      );
    }
    return;
  }
  const data = readLocal();
  data.holders = data.holders.filter((row) => row.epoch_id !== epochId);
  for (const row of rows) {
    data.holders.push({
      id: uuid(),
      epoch_id: epochId,
      owner_wallet: row.wallet,
      token_account: row.tokenAccount || "",
      balance_raw: row.balanceRaw,
      balance_ui: row.balanceUi == null ? null : String(row.balanceUi),
      weight: row.weight,
      reward_raw: row.rewardRaw,
      reward_ui: row.rewardUi,
      rank: row.rank,
      eligible: row.eligible !== false,
      in_holder_cap: row.inHolderCap,
      transfer_status: row.transferStatus || "pending",
      created_at: nowIso()
    });
  }
  writeLocal(data);
}

async function holdersForEpoch(epochId) {
  if (databaseConfigured()) {
    const result = await query("select * from reward_epoch_holders where epoch_id = $1 order by rank asc", [epochId]);
    return result.rows;
  }
  return readLocal().holders.filter((row) => row.epoch_id === epochId).sort((a, b) => a.rank - b.rank);
}

async function upsertBatches(epochId, batches) {
  if (databaseConfigured()) {
    for (const batch of batches) {
      await query(
        `
          insert into reward_epoch_batches (epoch_id, batch_index, status, transfer_count, total_reward_raw)
          values ($1,$2,'pending',$3,$4)
          on conflict (epoch_id, batch_index) do nothing
        `,
        [epochId, batch.batchIndex, batch.transferCount, batch.totalRewardRaw]
      );
    }
    return;
  }
  const data = readLocal();
  for (const batch of batches) {
    if (data.batches.some((row) => row.epoch_id === epochId && row.batch_index === batch.batchIndex)) continue;
    data.batches.push({
      id: uuid(),
      epoch_id: epochId,
      batch_index: batch.batchIndex,
      status: "pending",
      transfer_count: batch.transferCount,
      total_reward_raw: batch.totalRewardRaw,
      created_at: nowIso()
    });
  }
  writeLocal(data);
}

async function batchesForEpoch(epochId) {
  if (databaseConfigured()) {
    const result = await query("select * from reward_epoch_batches where epoch_id = $1 order by batch_index asc", [epochId]);
    return result.rows;
  }
  return readLocal().batches.filter((row) => row.epoch_id === epochId).sort((a, b) => a.batch_index - b.batch_index);
}

async function updateBatch(id, patch) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (databaseConfigured()) {
    const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
    const values = entries.map(([, value]) => value);
    await query(`update reward_epoch_batches set ${sets} where id = $1`, [id, ...values]);
    return;
  }
  const data = readLocal();
  const row = data.batches.find((batch) => batch.id === id);
  if (row) Object.assign(row, patch, { updated_at: nowIso() });
  writeLocal(data);
}

async function receipts(limit = 50) {
  if (databaseConfigured()) {
    const result = await query(
      `
        select r.*, e.epoch_index, e.manifest_hash
        from reward_receipts r
        left join reward_epochs e on e.id = r.epoch_id
        order by r.created_at desc
        limit $1
      `,
      [limit]
    );
    return result.rows;
  }
  const data = readLocal();
  return data.receipts.slice(-limit).reverse();
}

async function saveReceipt({
  epochId = null,
  batchId = null,
  recipientWallet = "",
  rewardMint = "",
  amountRaw = "0",
  amountUi = "",
  signature = "",
  solscanUrl = "",
  status = "recorded",
  notes = ""
}) {
  const createdAt = nowIso();
  if (databaseConfigured()) {
    const result = await query(
      `
        insert into reward_receipts
          (epoch_id, batch_id, recipient_wallet, reward_mint, amount_raw, amount_ui, signature, solscan_url, status, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        returning *
      `,
      [epochId, batchId, recipientWallet, rewardMint, amountRaw, amountUi, signature, solscanUrl, status, createdAt]
    );
    return result.rows[0];
  }
  const data = readLocal();
  const record = {
    id: uuid(),
    epoch_id: epochId,
    batch_id: batchId,
    recipient_wallet: recipientWallet,
    reward_mint: rewardMint,
    amount_raw: amountRaw,
    amount_ui: amountUi,
    signature,
    solscan_url: solscanUrl,
    status,
    notes,
    created_at: createdAt
  };
  data.receipts = data.receipts || [];
  data.receipts.push(record);
  writeLocal(data);
  return record;
}

async function writeCache(cacheKey, payload, sourceEpochId = null) {
  const generatedAt = nowIso();
  if (databaseConfigured()) {
    await query(
      `
        insert into dashboard_cache (cache_key, payload, generated_at, stale_after, source_epoch_id)
        values ($1,$2::jsonb,$3,$4,$5)
        on conflict (cache_key) do update set
          payload = excluded.payload,
          generated_at = excluded.generated_at,
          stale_after = excluded.stale_after,
          source_epoch_id = excluded.source_epoch_id
      `,
      [cacheKey, JSON.stringify(payload), generatedAt, new Date(Date.now() + 30_000).toISOString(), sourceEpochId]
    );
    return;
  }
  const data = readLocal();
  data.cache[cacheKey] = { payload, generated_at: generatedAt, stale_after: new Date(Date.now() + 30_000).toISOString(), source_epoch_id: sourceEpochId };
  writeLocal(data);
}

async function readCache(cacheKey) {
  if (databaseConfigured()) {
    const result = await query("select * from dashboard_cache where cache_key = $1 limit 1", [cacheKey]);
    return result.rows[0] ? rowToCamel(result.rows[0]) : null;
  }
  return readLocal().cache[cacheKey] || null;
}

async function listEpochs() {
  if (databaseConfigured()) {
    const result = await query("select * from reward_epochs order by epoch_index", []);
    return result.rows.map(rowToCamel);
  }
  const data = readLocal();
  return (data.epochs || []).sort((a, b) => a.epoch_index - b.epoch_index);
}

async function archiveEpoch(id) {
  return await updateEpoch(id, { status: "archived", completed_at: nowIso() });
}

async function deleteEpochAndData(id) {
  if (databaseConfigured()) {
    await query("delete from reward_receipts where epoch_id = $1", [id]);
    await query("delete from reward_epoch_batches where epoch_id = $1", [id]);
    await query("delete from reward_epoch_holders where epoch_id = $1", [id]);
    await query("delete from reward_epochs where id = $1", [id]);
    return { deleted: true };
  }
  const data = readLocal();
  data.receipts = (data.receipts || []).filter((r) => r.epoch_id !== id);
  data.batches = (data.batches || []).filter((b) => b.epoch_id !== id);
  data.holders = (data.holders || []).filter((h) => h.epoch_id !== id);
  data.epochs = (data.epochs || []).filter((e) => e.id !== id);
  writeLocal(data);
  return { deleted: true };
}

module.exports = {
  acquireLock,
  archiveEpoch,
  batchesForEpoch,
  createEpoch,
  currentEpoch,
  databaseConfigured,
  deleteEpochAndData,
  ensureRewardSchema,
  holdersForEpoch,
  latestEpoch,
  latestSnapshottedEpoch,
  listEpochs,
  query,
  readCache,
  receipts,
  releaseLock,
  saveReceipt,
  updateBatch,
  updateEpoch,
  upsertBatches,
  upsertHolderRows,
  writeCache
};
