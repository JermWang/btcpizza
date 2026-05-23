function databaseUrl() {
  return (
    process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ""
  );
}

function databaseUrlSource() {
  for (const key of ["SUPABASE_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"]) {
    if (process.env[key]) return key;
  }
  return "";
}

function databaseConfigured() {
  return Boolean(databaseUrl());
}

function removeConnectionParam(rawUrl, paramName) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete(paramName);
    return parsed.toString();
  } catch {
    return rawUrl.replace(new RegExp(`([?&])${paramName}=[^&]*&?`, "i"), (match, prefix) => (prefix === "?" && match.endsWith("&") ? "?" : ""));
  }
}

function databaseSslConfig(url = databaseUrl()) {
  if (!url) return undefined;
  if (/[?&]sslmode=disable(?:&|$)/i.test(url)) return false;
  return { rejectUnauthorized: false };
}

function postgresPoolConfig() {
  const url = databaseUrl();
  return {
    connectionString: removeConnectionParam(url, "sslmode"),
    ssl: databaseSslConfig(url),
    max: Number(process.env.DATABASE_POOL_MAX || 3),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000)
  };
}

module.exports = {
  databaseConfigured,
  databaseSslConfig,
  databaseUrl,
  databaseUrlSource,
  postgresPoolConfig
};
