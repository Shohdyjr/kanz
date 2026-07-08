const { Pool } = require("pg");
const env = require("../config/env");

// Hosted Postgres providers (Neon, Render, etc.) require SSL. Disabled only
// for local development against a localhost database.
const isLocal = env.databaseUrl.includes("localhost");

// Neon's connection string includes `sslmode=require`, which conflicts with
// the explicit `ssl` option below and triggers a pg-connection-string
// deprecation warning. We strip it here since we configure SSL ourselves.
function stripSslMode(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("sslmode");
    return parsed.toString();
  } catch {
    return url; // not a valid URL (e.g. malformed) — let `pg` surface the real error
  }
}

const pool = new Pool({
  connectionString: isLocal ? env.databaseUrl : stripSslMode(env.databaseUrl),
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

module.exports = pool;
