const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function storageRoot() {
  return path.resolve(process.env.ADMIN_STORAGE_PATH || path.join(process.cwd(), ".admin-data"));
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

function collectionDir(collection) {
  const dir = path.join(storageRoot(), collection);
  ensureDir(dir);
  return dir;
}

function atomicWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function saveRecord(collection, record) {
  const id = record.id || buildId(idPrefix(collection), record);
  const stored = {
    ...record,
    id,
    updatedAt: new Date().toISOString(),
    createdAt: record.createdAt || new Date().toISOString()
  };
  atomicWriteJson(path.join(collectionDir(collection), `${id}.json`), stored);
  atomicWriteJson(path.join(collectionDir(collection), "_latest.json"), { id, updatedAt: stored.updatedAt });
  return stored;
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readRecord(collection, id) {
  if (!id || id === "latest") return latestRecord(collection);
  return readJson(path.join(collectionDir(collection), `${id}.json`));
}

function latestRecord(collection) {
  const latest = readJson(path.join(collectionDir(collection), "_latest.json"));
  if (!latest?.id) return null;
  return readRecord(collection, latest.id);
}

function listRecords(collection) {
  const dir = collectionDir(collection);
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "_latest.json")
    .map((file) => readJson(path.join(dir, file)))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function appendAudit(event) {
  const record = {
    id: event.id || buildId("audit", event),
    timestamp: new Date().toISOString(),
    ...event
  };
  const filePath = path.join(storageRoot(), "audit-log.jsonl");
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

function readAudit(limit = 100) {
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

function storageSummary() {
  return {
    root: storageRoot(),
    auditCount: readAudit(10_000).length,
    latestManifest: latestRecord("manifests")?.id || "",
    latestBatch: latestRecord("batches")?.id || "",
    receiptCount: listRecords("receipts").length,
    manifestCount: listRecords("manifests").length,
    batchCount: listRecords("batches").length
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
