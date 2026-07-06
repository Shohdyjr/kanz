const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
const REMEMBER_TOKEN_DAYS = parseInt(process.env.REMEMBER_TOKEN_DAYS || "7", 10);

if (!JWT_SECRET) {
  console.warn("⚠ JWT_SECRET مش موجود في .env — حط قيمة سرية طويلة قبل ما ترفع المشروع فعليًا.");
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/** بيرجع { token, expiresAt } — الـ JWT نفسه بيحمل username جواه، فمفيش داعي نخزّنه في الداتابيز خالص */
function issueToken(username) {
  const expiresInSec = REMEMBER_TOKEN_DAYS * 24 * 60 * 60;
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: expiresInSec });
  const expiresAt = Date.now() + expiresInSec * 1000;
  return { token, expiresAt };
}

/** بيرجع username لو التوكن صالح، أو null لو مش صالح/منتهي */
function verifyTokenValue(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.username || null;
  } catch (e) {
    return null;
  }
}

/** Express middleware — بيتأكد من الـ Authorization header ويحط req.username */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const username = token ? verifyTokenValue(token) : null;
  if (!username) return res.status(401).json({ ok: false, error: "tokenInvalid" });
  req.username = username;
  next();
}

module.exports = { hashPassword, comparePassword, issueToken, verifyTokenValue, requireAuth };
