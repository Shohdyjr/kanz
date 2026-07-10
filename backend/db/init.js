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

  // Net money the user manually added/withdrew in a period (e.g. "salary minus
  // expenses this month"). Kept separate from `history` so the growth
  // calculations on the client can tell "I added money" apart from "what I
  // already had grew in value" — see docs/js/helpers.js computeGrowth().
  await pool.query(`ALTER TABLE kanz_users ADD COLUMN IF NOT EXISTS contributions JSONB NOT NULL DEFAULT '[]'::jsonb;`);

  // Optional recovery email — nullable because existing accounts predate this
  // column and not every user sets one. Used only by the forgot-password OTP
  // flow (routes/auth.js + lib/otp.js + lib/email.js). Partial unique index
  // (instead of a plain UNIQUE constraint) so multiple users can each still
  // have a NULL/unset email.
  await pool.query(`ALTER TABLE kanz_users ADD COLUMN IF NOT EXISTS email TEXT;`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS kanz_users_email_idx ON kanz_users (email) WHERE email IS NOT NULL;`
  );

  // One pending reset code per user at a time (PK on username) — requesting a
  // new code implicitly invalidates any previous one. Short-lived by design:
  // expires_at is checked (and the row deleted) in lib/otp.js.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanz_password_resets (
      username    TEXT PRIMARY KEY REFERENCES kanz_users(username) ON DELETE CASCADE,
      otp_hash    TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      attempts    INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Small durable key/value cache, currently used to remember the last
  // successfully-fetched gold price so a live API outage degrades gracefully
  // instead of failing the whole daily snapshot (see lib/rates.js).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanz_settings (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

module.exports = initDb;
