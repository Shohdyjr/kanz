const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const { hashPassword, comparePassword, sha256HexLegacy, issueToken, verifyTokenValue } = require("../lib/auth");
const { defaultUserData } = require("../lib/rates");

const router = express.Router();

// Basic brute-force protection: 20 attempts per 15 minutes per IP across all auth routes.
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }));

const fail = (res, error) => res.json({ ok: false, error });
const cleanUsername = (raw) => (raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

router.post("/signup", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = req.body.password || "";

    if (username.length < 3) return fail(res, "usernameTooShort");
    if (password.length < 8) return fail(res, "passwordTooShort");

    const exists = await pool.query("SELECT 1 FROM kanz_users WHERE username = $1", [username]);
    if (exists.rows.length > 0) return fail(res, "usernameTaken");

    const passwordHash = await hashPassword(password);
    await pool.query(
      "INSERT INTO kanz_users (username, password_hash, data) VALUES ($1, $2, $3)",
      [username, passwordHash, JSON.stringify(defaultUserData())]
    );

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

    const { rows } = await pool.query("SELECT password_hash, legacy_hash FROM kanz_users WHERE username = $1", [username]);
    if (rows.length === 0) return fail(res, "usernameNotFound");

    const { password_hash, legacy_hash } = rows[0];
    let match = password_hash ? await comparePassword(password, password_hash) : false;

    // Account migrated from the legacy Google Apps Script version — verify against
    // the old SHA-256 hash once, then transparently upgrade to bcrypt.
    if (!match && legacy_hash && sha256HexLegacy(password) === legacy_hash) {
      match = true;
      const upgraded = await hashPassword(password);
      await pool.query("UPDATE kanz_users SET password_hash = $1, legacy_hash = NULL WHERE username = $2", [upgraded, username]);
    }

    if (!match) return fail(res, "wrongPassword");

    const { token, expiresAt } = issueToken(username);
    res.json({ ok: true, username, token, expiresAt });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ ok: false, error: "genericError" });
  }
});

// Used by the client to silently re-validate a saved "remember me" token.
router.post("/verify", (req, res) => {
  const username = verifyTokenValue(req.body.token || "");
  if (!username) return fail(res, "tokenInvalid");
  res.json({ ok: true, username });
});

module.exports = router;
