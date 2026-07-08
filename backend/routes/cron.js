const express = require("express");
const env = require("../config/env");
const { safeEqual } = require("../lib/auth");
const { takeDailySnapshot } = require("../cron/dailySnapshot");

const router = express.Router();

/**
 * Accepts the shared secret either as a `?secret=` query param (for manual
 * testing or an external scheduler) or as `Authorization: Bearer <secret>`
 * (how Vercel Cron automatically sends the CRON_SECRET env var).
 */
function isAuthorizedCronRequest(req) {
  if (!env.cronSecret) return true; // no secret configured — leave the route open
  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return safeEqual(req.query.secret || "", env.cronSecret) || safeEqual(bearer, env.cronSecret);
}

// Triggered once a day by Vercel Cron (see vercel.json), ~3 AM Cairo time.
router.all("/daily-snapshot", async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  try {
    await takeDailySnapshot();
    res.json({ ok: true });
  } catch (err) {
    console.error("daily-snapshot cron error:", err);
    res.status(500).json({ ok: false, error: "cronFailed" });
  }
});

module.exports = router;
