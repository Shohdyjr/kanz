const crypto = require("crypto");
const pool = require("../db/pool");

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5; // wrong guesses before a code is invalidated outright

/** Random 6-digit numeric code, zero-padded (e.g. "042917"). */
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Codes are never stored in plaintext — only their SHA-256 hash. */
function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp, "utf8").digest("hex");
}

/** Issues (or replaces) the pending reset code for a user. */
async function storeOtp(username, otp) {
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await pool.query(
    `INSERT INTO kanz_password_resets (username, otp_hash, expires_at, attempts)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (username) DO UPDATE
       SET otp_hash = EXCLUDED.otp_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
    [username, otpHash, expiresAt]
  );
}

/**
 * Checks a submitted code against the stored one. On any outcome other than
 * "wrong code, attempts remaining" the pending row is deleted, so a code can
 * only ever be used once and a stale/expired/exhausted one can't linger.
 */
async function verifyAndConsumeOtp(username, otp) {
  const { rows } = await pool.query(
    "SELECT otp_hash, expires_at, attempts FROM kanz_password_resets WHERE username = $1",
    [username]
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "otpInvalid" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query("DELETE FROM kanz_password_resets WHERE username = $1", [username]);
    return { ok: false, error: "otpExpired" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await pool.query("DELETE FROM kanz_password_resets WHERE username = $1", [username]);
    return { ok: false, error: "otpTooManyAttempts" };
  }

  if (hashOtp(otp) !== row.otp_hash) {
    await pool.query("UPDATE kanz_password_resets SET attempts = attempts + 1 WHERE username = $1", [username]);
    return { ok: false, error: "otpInvalid" };
  }

  await pool.query("DELETE FROM kanz_password_resets WHERE username = $1", [username]);
  return { ok: true };
}

module.exports = { OTP_TTL_MS, MAX_ATTEMPTS, generateOtp, hashOtp, storeOtp, verifyAndConsumeOtp };
