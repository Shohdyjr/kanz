const pool = require("./pool");

/**
 * نفس فكرة الشيت القديم (kanz_users) بس في جدول Postgres حقيقي.
 * data و history أعمدة JSONB — نفس الفكرة اللي كانت في الـ Apps Script
 * (تخزين JSON كنص) لكن هنا Postgres بيفهم الـ JSON فعليًا فتقدر تستعلم
 * عليه لو احتجت مستقبلاً.
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kanz_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      data          JSONB NOT NULL DEFAULT '{}'::jsonb,
      history       JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  console.log("✓ Database ready (kanz_users table checked/created)");
}

module.exports = initDb;
