import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

async function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    try {
      const text = await readFile(join(process.cwd(), file), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        const [, key, raw] = match;
        if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    } catch {
      // Optional local env files are expected to be absent in fresh clones.
    }
  }
}

await loadEnv();

const { databaseConfigured, databaseUrlSource } = require("../lib/database");
const { storageSummary } = require("../lib/admin-store");
const rewardsStore = require("../lib/rewards/store");

if (!databaseConfigured()) {
  console.error("No Postgres URL is configured. Set SUPABASE_DATABASE_URL or DATABASE_URL.");
  process.exit(1);
}

try {
  const adminStorage = await storageSummary();
  await rewardsStore.ensureRewardSchema();
  const probe = await rewardsStore.query("select current_database() as database, current_user as user");
  const row = probe.rows[0] || {};
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: databaseUrlSource(),
        database: row.database,
        user: row.user,
        adminStorage,
        rewardSchemaReady: true
      },
      null,
      2
    )
  );
  process.exit(0);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        source: databaseUrlSource(),
        code: error.code || "",
        message: error.message || String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
}
