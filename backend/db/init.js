const pool = require("./pool");

/**
 * Creates the users table if it doesn't exist, and applies additive
 * migrations (safe to run on every cold start — all statements are
 * idempotent).
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanz_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      data          JSONB NOT NULL DEFAULT '{}'::jsonb,
      history       JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`ALTER TABLE kanz_users ALTER COLUMN password_hash DROP NOT NULL;`);

  // One-time cleanup: drops the legacy_hash column left over from the old
  // Google Apps Script version (unsalted SHA-256 password compat), now that
  // the app no longer reads or writes it. Safe to run repeatedly — a no-op
  // once the column is gone.
  await pool.query(`ALTER TABLE kanz_users DROP COLUMN IF EXISTS legacy_hash;`);

  // Net money the user manually added/withdrew in a period (e.g. "salary minus
  // expenses this month"). Kept separate from `history` so the growth
  // calculations on the client can tell "I added money" apart from "what I
  // already had grew in value" — see docs/js/helpers.js computeGrowth().
  await pool.query(`ALTER TABLE kanz_users ADD COLUMN IF NOT EXISTS activities JSONB NOT NULL DEFAULT '[]'::jsonb;`);

  // One-time rename: this column started life as `contributions` back when
  // it only held income/expense entries. It now holds every logged Activity
  // (salary, deposit, withdrawal, buy, sell, transfer, correction), so the
  // column name is renamed to match — "contributions" now refers only to
  // the money-added-vs-market-grew calculation (see sumContributionsBetween
  // in docs/js/helpers.js), not this log itself. Safe to run repeatedly:
  // a no-op once the old column is gone.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kanz_users' AND column_name = 'contributions')
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kanz_users' AND column_name = 'activities')
      THEN
        ALTER TABLE kanz_users RENAME COLUMN contributions TO activities;
      ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kanz_users' AND column_name = 'contributions') THEN
        -- Both columns exist (interrupted prior run) — merge any stragglers into activities, then drop the old one.
        UPDATE kanz_users SET activities = contributions WHERE activities = '[]'::jsonb AND contributions != '[]'::jsonb;
        ALTER TABLE kanz_users DROP COLUMN contributions;
      END IF;
    END $$;
  `);

  // Per-item history: one entry per (itemId, date) whenever the daily cron
  // applies an item's APY growth. Lets the UI show "this item grew from X to
  // Y on this date" per item, separate from the aggregate `history` snapshots
  // and from manually-logged `activities`. See cron/dailySnapshot.js.
  await pool.query(`ALTER TABLE kanz_users ADD COLUMN IF NOT EXISTS item_history JSONB NOT NULL DEFAULT '[]'::jsonb;`);

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
