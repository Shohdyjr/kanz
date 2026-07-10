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
  rememberTokenDays: parseInt(process.env.REMEMBER_TOKEN_DAYS || "1", 10),
  port: parseInt(process.env.PORT || "3000", 10),
  apiLayerKey: process.env.APILAYER_KEY || null,
  // SMTP is only used for the "forgot password" OTP email (lib/email.js). Left
  // unset in dev: sendOtpEmail() falls back to logging the code to the
  // console instead of failing the request, so the flow stays testable
  // without a real mail account.
  smtp: {
    host: process.env.SMTP_HOST || null,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || null,
    pass: process.env.SMTP_PASS || null,
    from: process.env.SMTP_FROM || "Kanz <no-reply@kanz.app>",
  },
};

if (env.frontendOrigin === "*") {
  console.warn("⚠ FRONTEND_ORIGIN is not set — CORS is open to all origins. Set it before going to production.");
}
if (!env.cronSecret) {
  console.warn("⚠ CRON_SECRET is not set — /api/cron/daily-snapshot is unprotected (anyone could trigger it).");
}
if (!env.smtp.host) {
  console.warn("⚠ SMTP_HOST is not set — password-reset OTP emails will be logged to the console instead of sent.");
}

module.exports = env;
