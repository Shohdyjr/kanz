#!/usr/bin/env node
/**
 * Emergency password reset — run this on your own machine when a user forgets
 * their password. Requires DATABASE_URL and JWT_SECRET in the environment.
 *
 * Usage:
 *   node scripts/reset-password.js <username> <newPassword>
 */
require("dotenv").config();
const { hashPassword } = require("../lib/auth");
const pool = require("../db/pool");

async function main() {
  const [, , username, newPassword] = process.argv;
  if (!username || !newPassword) {
    console.error("Usage: node scripts/reset-password.js <username> <newPassword>");
    process.exit(1);
  }
  if (newPassword.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
  const { rows } = await pool.query("SELECT 1 FROM kanz_users WHERE username = $1", [username]);
  if (rows.length === 0) {
    console.error(`User "${username}" not found.`);
    process.exit(1);
  }
  const hash = await hashPassword(newPassword);
  await pool.query("UPDATE kanz_users SET password_hash = $1 WHERE username = $2", [hash, username]);
  console.log(`Password for "${username}" updated successfully.`);
  await pool.end();
}
main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
