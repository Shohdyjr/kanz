const pool = require("./pool");

/**
 * Creates the users table if it doesn't exist, and applies additive
 * migrations (safe to run on every cold start — all statements are
 * idempotent).
 *
 * legacy_hash: holds a SHA-256 password hash for accounts imported from the
 * legacy Google Apps Script version. Cleared automatically the first time
 * that user logs in successfully (see routes/auth.js).
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanz_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      legacy_hash   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      data          JSONB NOT NULL DEFAULT '{}'::jsonb,
      history       JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`ALTER TABLE kanz_users ADD COLUMN IF NOT EXISTS legacy_hash TEXT;`);
  await pool.query(`ALTER TABLE kanz_users ALTER COLUMN password_hash DROP NOT NULL;`);
}

module.exports = initDb;
