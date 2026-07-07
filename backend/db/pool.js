const { Pool } = require("pg");
const env = require("../config/env");

// Hosted Postgres providers (Neon, Render, etc.) require SSL. Disabled only
// for local development against a localhost database.
const isLocal = env.databaseUrl.includes("localhost");

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

module.exports = pool;
