const { holdersPayload } = require("../../lib/rewards/snapshotCache");
const store = require("../../lib/rewards/store");
const { sendJson } = require("../../lib/vercel-api");

module.exports = async function handler(request, response) {
  response.setHeader("cache-control", "s-maxage=10, stale-while-revalidate=30");
  if (request.method !== "GET") {
    response.setHeader("allow", "GET");
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }
  const wallet = request.query?.wallet || "";
  try {
    sendJson(response, 200, await holdersPayload(wallet));
  } catch (liveError) {
    // DB degraded — serve last cached snapshot rather than empty rows.
    try {
      const cached = await store.readCache("rewards_holders_latest");
      if (cached?.payload) {
        sendJson(response, 200, {
          ...cached.payload,
          degraded: true,
          reason: "rpc_unavailable_serving_cached_snapshot",
          message: "Showing last confirmed snapshot. RPC refresh is catching up.",
          last_successful_snapshot_at: cached.generatedAt || cached.generated_at || "",
          cached_at: cached.generatedAt || cached.generated_at || ""
        });
        return;
      }
    } catch {
      // Cache also unavailable — fall through to empty response.
    }
    sendJson(response, 200, {
      ok: true,
      degraded: true,
      reason: "rpc_unavailable_serving_cached_snapshot",
      message: "Showing last confirmed snapshot. RPC refresh is catching up.",
      rows: [],
      holders: [],
      error: liveError.message
    });
  }
};
