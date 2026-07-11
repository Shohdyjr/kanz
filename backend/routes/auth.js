const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const { hashPassword, comparePassword, issueToken, verifyTokenValue, requireAuth } = require("../lib/auth");
const { defaultUserData } = require("../lib/rates");
const { generateOtp, storeOtp, verifyAndConsumeOtp } = require("../lib/otp");
const { sendOtpEmail } = require("../lib/email");

const router = express.Router();

// Basic brute-force protection: 20 attempts per 15 minutes per IP across all auth routes.
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));

// Sending an email (or guessing an OTP) is more expensive/abusable than a
// plain login attempt, so /forgot-password and /reset-password get a
// tighter limit layered on top of the router-wide one above.
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });

const fail = (res, error) => res.json({ ok: false, error });
const cleanUsername = (raw) =>
  (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

// Deliberately permissive (format only, not deliverability) — the real check
// is whether the confirmation/OTP mail actually arrives.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (raw) => (raw || "").trim().toLowerCase();

router.post("/signup", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = req.body.password || "";
    const email = cleanEmail(req.body.email);

    if (username.length < 3) return fail(res, "usernameTooShort");
    if (password.length < 12) return fail(res, "passwordTooShort");
    if (email && !EMAIL_RE.test(email)) return fail(res, "emailInvalid");

    const exists = await pool.query("SELECT 1 FROM kanz_users WHERE username = $1", [username]);
    if (exists.rows.length > 0) return fail(res, "usernameTaken");

    if (email) {
      const emailTaken = await pool.query("SELECT 1 FROM kanz_users WHERE email = $1", [email]);
      if (emailTaken.rows.length > 0) return fail(res, "emailTaken");
    }

    const passwordHash = await hashPassword(password);
    await pool.query("INSERT INTO kanz_users (username, password_hash, email, data) VALUES ($1, $2, $3, $4)", [
      username,
      passwordHash,
      email || null,
      JSON.stringify(defaultUserData()),
    ]);

    // Sign the user in immediately so the client doesn't need a second round trip.
    const { token, expiresAt } = issueToken(username);
    res.json({ ok: true, username, token, expiresAt });
  } catch (err) {
    console.error("signup error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = req.body.password || "";
    if (!username || !password) return fail(res, "enterCredentials");

    const { rows } = await pool.query("SELECT password_hash FROM kanz_users WHERE username = $1", [username]);
    if (rows.length === 0) return fail(res, "usernameNotFound");

    const { password_hash } = rows[0];
    const match = password_hash ? await comparePassword(password, password_hash) : false;

    if (!match) return fail(res, "wrongPassword");

    const { token, expiresAt } = issueToken(username);
    res.json({ ok: true, username, token, expiresAt });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

// Used by the client to silently re-validate a saved "remember me" token.
// Returns a freshly-signed token so the 1-day expiry effectively auto-renews
// on every page load — the user only gets logged out if they stay away for
// more than one full day without opening the app.
router.post("/verify", (req, res) => {
  const username = verifyTokenValue(req.body.token || "");
  if (!username) return fail(res, "tokenInvalid");
  const { token, expiresAt } = issueToken(username);
  res.json({ ok: true, username, token, expiresAt });
});

// ── Forgot password (email OTP) ─────────────────────────────────────
// Two-step flow: request a 6-digit code by username, then submit that code
// together with a new password. The code is single-use, expires in 10
// minutes, and is stored only as a hash (see lib/otp.js) — mirroring how
// passwords themselves are never kept in plaintext.

router.post("/forgot-password", resetLimiter, async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    if (!username) return fail(res, "enterUsername");

    const { rows } = await pool.query("SELECT email FROM kanz_users WHERE username = $1", [username]);
    if (rows.length === 0) return fail(res, "usernameNotFound");
    if (!rows[0].email) return fail(res, "noEmailOnFile");

    const otp = generateOtp();
    await storeOtp(username, otp);
    await sendOtpEmail(rows[0].email, otp);

    // Masked so the UI can show "code sent to a***@gmail.com" without fully
    // re-exposing an address the user may not have typed in this session.
    const maskedEmail = rows[0].email.replace(/^(.).*(@.*)$/, "$1***$2");
    res.json({ ok: true, maskedEmail });
  } catch (err) {
    console.error("forgot-password error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

router.post("/reset-password", resetLimiter, async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const otp = (req.body.otp || "").trim();
    const newPassword = req.body.newPassword || "";

    if (!username || !otp) return fail(res, "otpInvalid");
    if (newPassword.length < 12) return fail(res, "passwordTooShort");

    const check = await verifyAndConsumeOtp(username, otp);
    if (!check.ok) return fail(res, check.error);

    const passwordHash = await hashPassword(newPassword);
    await pool.query("UPDATE kanz_users SET password_hash = $1 WHERE username = $2", [passwordHash, username]);

    // Log the user straight in, same as signup/login, so they don't have to
    // re-enter the password they just set.
    const { token, expiresAt } = issueToken(username);
    res.json({ ok: true, username, token, expiresAt });
  } catch (err) {
    console.error("reset-password error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

// ── Recovery email management (for already-logged-in users) ────────────
// Lets an existing account add/change the email forgot-password codes get
// sent to — useful for accounts created before this field existed, or
// anyone who skipped it at signup.
router.put("/email", requireAuth, async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    if (!email || !EMAIL_RE.test(email)) return fail(res, "emailInvalid");

    const taken = await pool.query("SELECT 1 FROM kanz_users WHERE email = $1 AND username != $2", [
      email,
      req.username,
    ]);
    if (taken.rows.length > 0) return fail(res, "emailTaken");

    await pool.query("UPDATE kanz_users SET email = $1 WHERE username = $2", [email, req.username]);
    res.json({ ok: true, email });
  } catch (err) {
    console.error("update-email error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

// The router remains the default export used by app.js. cleanUsername is
// attached as a property purely so it can be unit tested in isolation.
module.exports = router;
module.exports.cleanUsername = cleanUsername;
module.exports.cleanEmail = cleanEmail;
module.exports.EMAIL_RE = EMAIL_RE;
