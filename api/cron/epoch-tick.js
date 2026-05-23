const { epochTick, isCronAuthorized } = require("../../lib/rewards/epochs");
const { runScheduledEpoch } = require("../../lib/admin-control");
const { sendJson } = require("../../lib/vercel-api");

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  if (!isCronAuthorized(request.headers)) {
    sendJson(response, 401, { ok: false, error: "Cron authorization failed." });
    return;
  }

  const body = parseBody(request);

  // 1. Always run the rewards engine tick for public dashboard / epochs
  const rewardsResult = await epochTick({
    source: body.source || "cron-job.org",
    task: body.task || "epoch-tick"
  });

  // 2. If admin automation is armed, also run the money-ops epoch.
  // Wrapped in Promise.race so a hanging RPC call (e.g. dead Helius key causing
  // confirmTransaction to poll forever) cannot exceed the Vercel function timeout.
  const ADMIN_EPOCH_TIMEOUT_MS = 25_000;
  let adminResult = null;
  try {
    adminResult = await Promise.race([
      runScheduledEpoch({
        force: false,
        source: body.source || "cron-job.org",
        payload: body.payload || {}
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("runScheduledEpoch timed out after 25s — RPC may be unavailable")),
          ADMIN_EPOCH_TIMEOUT_MS
        )
      )
    ]);
  } catch (adminError) {
    adminResult = { ok: false, status: "failed", error: adminError.message || "Admin epoch failed." };
  }

  const combined = {
    ok: rewardsResult.ok !== false,
    rewards: rewardsResult,
    admin: adminResult
  };

  sendJson(response, combined.ok === false ? 500 : 200, combined);
};
