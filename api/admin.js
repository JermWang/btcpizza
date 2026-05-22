const { adminAuthError, adminStatus, isAdminAuthorized, runAdminAction } = require("../lib/admin-control");
const { sendJson } = require("../lib/vercel-api");

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
  if (!isAdminAuthorized(request.headers)) {
    sendJson(response, 401, {
      ok: false,
      error: adminAuthError()
    });
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, adminStatus());
      return;
    }

    if (request.method === "POST") {
      const body = parseBody(request);
      const result = await runAdminAction(body.action, body);
      sendJson(response, result.ok ? 200 : 502, result);
      return;
    }

    response.setHeader("allow", "GET, POST");
    sendJson(response, 405, {
      ok: false,
      error: "Method not allowed."
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      ok: false,
      error: error.message || "Admin action failed."
    });
  }
};
