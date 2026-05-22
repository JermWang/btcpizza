const { isAdminAuthorized, runScheduledEpoch } = require("../lib/admin-control");
const { epochTick } = require("../lib/rewards/epochs");
const { cronSecretMatches } = require("../lib/secret-auth");
const { sendJson } = require("../lib/vercel-api");

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const exact = headers[name] || headers[name.toLowerCase()];
  if (Array.isArray(exact)) return exact[0] || "";
  return exact || "";
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function requestSearchParams(request) {
  if (request.query && typeof request.query === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query)) {
      if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
      else if (value !== undefined && value !== null) params.set(key, value);
    }
    return params;
  }
  const host = headerValue(request.headers, "host") || "localhost";
  return new URL(request.url || "/", `https://${host}`).searchParams;
}

function firstParam(params, names) {
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return "";
}

function isCronAuthorized(request) {
  const headers = request.headers;
  if (isAdminAuthorized(headers)) return true;
  const authorization = headerValue(headers, "authorization");
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const params = requestSearchParams(request);
  return [bearer, headerValue(headers, "x-cron-secret"), firstParam(params, ["secret", "cron_secret", "cronSecret", "token"])].some(
    (candidate) => cronSecretMatches(candidate)
  );
}

module.exports = async function handler(request, response) {
  if (!isCronAuthorized(request)) {
    sendJson(response, 401, {
      ok: false,
      error: "Epoch cron authorization failed."
    });
    return;
  }

  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("allow", "GET, POST");
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const body = request.method === "POST" ? parseBody(request) : {};
    const params = requestSearchParams(request);

    // 1. Always run the rewards engine tick for public dashboard / epochs
    const rewardsResult = await epochTick({
      source: body.source || "cron-job.org",
      task: body.task || "epoch-tick"
    });

    // 2. If admin automation is armed, also run the money-ops epoch
    let adminResult = null;
    try {
      adminResult = await runScheduledEpoch({
        force: body.force === true || params.get("force") === "true",
        source: body.source || "cron",
        payload: body.payload || {}
      });
    } catch (adminError) {
      adminResult = { ok: false, status: "failed", error: adminError.message || "Admin epoch failed." };
    }

    sendJson(response, 200, {
      ok: true,
      action: "epoch-tick",
      rewards: rewardsResult,
      admin: adminResult
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      ok: false,
      error: error.message || "Epoch runner failed."
    });
  }
};
