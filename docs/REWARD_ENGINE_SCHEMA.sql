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
