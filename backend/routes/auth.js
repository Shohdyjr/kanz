const express = require("express");
const pool = require("../db/pool");
const { hashPassword, comparePassword, issueToken, verifyTokenValue } = require("../lib/auth");
const { defaultUserData } = require("../lib/rates");

const router = express.Router();

function fail(res, error, status = 200) {
  return res.status(status).json({ ok: false, error });
}

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  try {
    const usernameRaw = req.body.username || "";
    const password = req.body.password || "";
    const clean = usernameRaw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");

    if (!clean || clean.length < 3) return fail(res, "usernameTooShort");
    if (!password || password.length < 4) return fail(res, "passwordTooShort");

    const existing = await pool.query("SELECT id FROM kanz_users WHERE username = $1", [clean]);
    if (existing.rows.length > 0) return fail(res, "usernameTaken");

    const passwordHash = await hashPassword(password);
    await pool.query(
      "INSERT INTO kanz_users (username, password_hash, data, history) VALUES ($1, $2, $3, '[]'::jsonb)",
      [clean, passwordHash, JSON.stringify(defaultUserData())]
    );

    // بنسجّل دخوله تلقائيًا بعد إنشاء الحساب — بيرجع توكن جاهز من غير خطوة إضافية
    const { token, expiresAt } = issueToken(clean);
    res.json({ ok: true, username: clean, token, expiresAt });
  } catch (err) {
    console.error("signup error:", err);
    fail(res, "genericError", 500);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const username = (req.body.username || "").trim().toLowerCase();
    const password = req.body.password || "";
    if (!username || !password) return fail(res, "enterCredentials");

    const result = await pool.query("SELECT password_hash FROM kanz_users WHERE username = $1", [username]);
    if (result.rows.length === 0) return fail(res, "usernameNotFound");

    const match = await comparePassword(password, result.rows[0].password_hash);
    if (!match) return fail(res, "wrongPassword");

    const { token, expiresAt } = issueToken(username);
    res.json({ ok: true, username, token, expiresAt });
  } catch (err) {
    console.error("login error:", err);
    fail(res, "genericError", 500);
  }
});

// POST /api/auth/verify — بيستخدمها attemptAutoLogin عشان يتأكد إن توكن "تذكرني" المحفوظ لسه صالح
router.post("/verify", async (req, res) => {
  const token = req.body.token || "";
  const username = verifyTokenValue(token);
  if (!username) return fail(res, "tokenInvalid");
  res.json({ ok: true, username });
});

module.exports = router;
