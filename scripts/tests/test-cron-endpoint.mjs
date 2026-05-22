import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Load local .env
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
try {
  const text = await readFile(join(root, ".env"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!process.env[key]) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
} catch {
  // ignore
}

const cronHandler = require("../../api/cron/epoch-tick.js");

// Simulate a cron request
const mockRequest = {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.CRON_SECRET || "test"}`
  },
  body: {
    source: "test-script",
    task: "epoch-tick"
  }
};

const mockResponse = {
  statusCode: null,
  headers: {},
  body: null,
  setHeader(key, value) { this.headers[key] = value; },
  json(data) { this.body = data; }
};

// We need to mock sendJson since the handler uses it
const originalSendJson = require("../../lib/vercel-api").sendJson;
require("../../lib/vercel-api").sendJson = (res, status, data) => {
  res.statusCode = status;
  res.body = data;
};

async function main() {
  console.log("Testing cron endpoint...");
  console.log("CRON_SECRET configured:", Boolean(process.env.CRON_SECRET));

  try {
    await cronHandler(mockRequest, mockResponse);
    console.log("\nResponse status:", mockResponse.statusCode);
    console.log("Response body:", JSON.stringify(mockResponse.body, null, 2));
  } catch (error) {
    console.error("Cron handler failed:", error.message);
    console.error(error.stack);
  } finally {
    require("../../lib/vercel-api").sendJson = originalSendJson;
  }
}

main().catch(console.error);
