const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let schemaReady = false;

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.VERCEL_REGION ||
      process.env.NOW_REGION ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.cwd().startsWith("/var/task")
  );
}

function storageRoot() {
  const configured = process.env.ADMIN_STORAGE_PATH || "";
  const defaultLocalPaths = new Set(["", "./.admin-data", ".admin-data", "/var/task/.admin-data"]);
  if (isServerlessRuntime() && (defaultLocalPaths.has(configured) || configured.includes("/var/task"))) {
    return path.join(os.tmpdir(), "bitcoin-pizza-strategy-admin-data");
  }
  return path.resolve(configured || path.join(process.cwd(), ".admin-data"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonical(value[key]);
        return result;
      }, {});
  }
  return value;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function shortTime() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function buildId(prefix, value) {
  return `${prefix}_${shortTime()}_${stableHash(value).slice(0, 12)}`;
}

function idPrefix(collection) {
  return (
    {
      batches: "batch",
      manifests: "manifest",
      receipts: "receipt",
      snapshots: "snapshot"
    }[collection] || collection.replace(/s$/, "")
  );
}

function databaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

function databaseConfigured() {
  return Boolean(databaseUrl());
}

function filesystemConfigured() {
  return !databaseConfigured() && !isServerlessRuntime();
}

function serverlessDatabaseError() {
  return new Error("DATABASE_URL is required for durable admin storage in serverless production.");
}

function pool() {
  if (!globalThis.__btcPizzaAdminPgPool) {
      const { Pool } = require("pg");
      globalThis.__btcPizzaAdminPgPool = new Pool({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000)
    });
  }
  return globalThis.__btcPizzaAdminPgPool;
}

async function ensureSchema() {
  if (!databaseConfigured() || schemaReady) return;
  await pool().query(`
    create table if not exists admin_records (
      collection text not null,
      id text not null,
      payload jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (collection, id)
    );
    create index if not exists admin_records_collection_created_idx
      on admin_records (collection, created_at desc);
    create table if not exists admin_audit_events (
      id text primary key,
      action text,
      status text,
      payload jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists admin_audit_events_created_idx
      on admin_audit_events (created_at desc);
  `);
  schemaReady = true;
}

function collectionDir(collection) {
  if (!filesystemConfigured()) throw serverlessDatabaseError();
  const dir = path.join(storageRoot(), collection);
  ensureDir(dir);
  return dir;
}

function atomicWriteJson(filePath, value) {
  if (!filesystemConfigured()) throw serverlessDatabaseError();
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback = null) {
  if (!filesystemConfigured()) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function saveRecord(collection, record) {
  const id = record.id || buildId(idPrefix(collection), record);
  const stored = {
    ...record,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString()
  };

  if (databaseConfigured()) {
    await ensureSchema();
    await pool().query(
      `
        insert into admin_records (collection, id, payload, created_at, updated_at)
        values ($1, $2, $3::jsonb, $4, $5)
        on conflict (collection, id) do update set
          payload = excluded.payload,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
      [collection, id, JSON.stringify(stored), stored.createdAt, stored.updatedAt]
    );
    return stored;
  }

  if (!filesystemConfigured()) throw serverlessDatabaseError();

  atomicWriteJson(path.join(collectionDir(collection), `${id}.json`), stored);
  atomicWriteJson(path.join(collectionDir(collection), "_latest.json"), { id, updatedAt: stored.updatedAt });
  return stored;
}

async function latestRecord(collection) {
  if (databaseConfigured()) {
    await ensureSchema();
    const result = await pool().query(
      `
        select payload
        from admin_records
        where collection = $1
        order by created_at desc, updated_at desc
        limit 1
      `,
      [collection]
    );
    return result.rows[0]?.payload || null;
  }

  if (!filesystemConfigured()) return null;

  const latest = readJson(path.join(collectionDir(collection), "_latest.json"));
  if (!latest?.id) return null;
  return await readRecord(collection, latest.id);
}

async function readRecord(collection, id) {
  if (!id || id === "latest") return await latestRecord(collection);

  if (databaseConfigured()) {
    await ensureSchema();
    const result = await pool().query(
      "select payload from admin_records where collection = $1 and id = $2 limit 1",
      [collection, id]
    );
    return result.rows[0]?.payload || null;
  }

  if (!filesystemConfigured()) return null;

  return readJson(path.join(collectionDir(collection), `${id}.json`));
}

async function listRecords(collection) {
  if (databaseConfigured()) {
    await ensureSchema();
    const result = await pool().query(
      `
        select payload
        from admin_records
        where collection = $1
        order by created_at desc, updated_at desc
      `,
      [collection]
    );
    return result.rows.map((row) => row.payload).filter(Boolean);
  }

  if (!filesystemConfigured()) return [];

  const dir = collectionDir(collection);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "_latest.json")
    .map((file) => readJson(path.join(dir, file)))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function appendAudit(event) {
  const record = {
    id: event.id || buildId("audit", event),
    timestamp: new Date().toISOString(),
    ...event
  };

  if (databaseConfigured()) {
    await ensureSchema();
    await pool().query(
      `
        insert into admin_audit_events (id, action, status, payload, created_at)
        values ($1, $2, $3, $4::jsonb, $5)
        on conflict (id) do nothing
      `,
      [record.id, record.action || "", record.status || "", JSON.stringify(record), record.timestamp]
    );
    return record;
  }

  if (!filesystemConfigured()) return record;

  const filePath = path.join(storageRoot(), "audit-log.jsonl");
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

async function readAudit(limit = 100) {
  if (databaseConfigured()) {
    await ensureSchema();
    const result = await pool().query(
      `
        select payload
        from admin_audit_events
        order by created_at desc
        limit $1
      `,
      [Math.max(1, Math.floor(Number(limit) || 100))]
    );
    return result.rows.map((row) => row.payload).filter(Boolean);
  }

  if (!filesystemConfigured()) return [];

  const filePath = path.join(storageRoot(), "audit-log.jsonl");
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line))
      .reverse();
  } catch {
    return [];
  }
}

async function storageSummary() {
  const [audit, latestManifest, latestBatch, receipts, manifests, batches] = await Promise.all([
    readAudit(10_000),
    latestRecord("manifests"),
    latestRecord("batches"),
    listRecords("receipts"),
    listRecords("manifests"),
    listRecords("batches")
  ]);

  return {
    backend: databaseConfigured() ? "postgres" : filesystemConfigured() ? "filesystem" : "unconfigured",
    root: databaseConfigured() ? "postgres env" : filesystemConfigured() ? storageRoot() : "DATABASE_URL required",
    auditCount: audit.length,
    latestManifest: latestManifest?.id || "",
    latestBatch: latestBatch?.id || "",
    receiptCount: receipts.length,
    manifestCount: manifests.length,
    batchCount: batches.length
  };
}

module.exports = {
  appendAudit,
  buildId,
  latestRecord,
  listRecords,
  readAudit,
  readRecord,
  saveRecord,
  stableHash,
  storageSummary
};
