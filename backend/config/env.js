/**
 * Centralized environment configuration.
 * Fails fast on startup if a required secret is missing, instead of
 * silently running with an undefined JWT secret (a real security risk).
 */
require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const env = {
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  cronSecret: process.env.CRON_SECRET || null,
  frontendOrigin: process.env.FRONTEND_ORIGIN || "*",
  rememberTokenDays: parseInt(process.env.REMEMBER_TOKEN_DAYS || "7", 10),
  port: parseInt(process.env.PORT || "3000", 10),
  apiLayerKey: process.env.APILAYER_KEY || null,
};

if (env.frontendOrigin === "*") {
  console.warn("⚠ FRONTEND_ORIGIN is not set — CORS is open to all origins. Set it before going to production.");
}
if (!env.cronSecret) {
  console.warn("⚠ CRON_SECRET is not set — /api/cron/daily-snapshot is unprotected (anyone could trigger it).");
}

module.exports = env;
