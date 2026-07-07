const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("../config/env");

const hashPassword = (password) => bcrypt.hash(password, 10);
const comparePassword = (password, hash) => bcrypt.compare(password, hash);

/** Matches the legacy Apps Script hashing scheme (unsalted SHA-256 hex). */
const sha256HexLegacy = (password) =>
  crypto.createHash("sha256").update(password, "utf8").digest("hex");

/** Issues a stateless JWT. No server-side session storage needed. */
function issueToken(username) {
  const expiresInSec = env.rememberTokenDays * 24 * 60 * 60;
  const token = jwt.sign({ username }, env.jwtSecret, { expiresIn: expiresInSec });
  return { token, expiresAt: Date.now() + expiresInSec * 1000 };
}

/** Returns the username if the token is valid and unexpired, else null. */
function verifyTokenValue(token) {
  try {
    return jwt.verify(token, env.jwtSecret).username || null;
  } catch {
    return null;
  }
}

/** Express middleware: requires a valid `Authorization: Bearer <token>` header. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const username = token ? verifyTokenValue(token) : null;
  if (!username) return res.status(401).json({ ok: false, error: "tokenInvalid" });
  req.username = username;
  next();
}

/** Constant-time string comparison, used for the cron shared secret. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = {
  hashPassword,
  comparePassword,
  sha256HexLegacy,
  issueToken,
  verifyTokenValue,
  requireAuth,
  safeEqual,
};
