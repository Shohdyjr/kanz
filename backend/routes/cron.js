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

const TARGET_CAIRO_HOUR = 3; // run once the clock hits 3 AM Cairo time

/**
 * A Vercel Cron schedule is a fixed UTC time, but Egypt's DST rules have
 * changed more than once in recent years — a schedule tuned for "3 AM Cairo"
 * today can silently drift to 2 AM or 4 AM if the offset changes again.
 * vercel.json instead runs this route every hour, and this function decides
 * whether it's actually the target hour in Cairo right now. Running the
 * snapshot itself is also idempotent (it upserts by date), so firing more
 * than once in the target hour is harmless.
 */
function isCairoTargetHour() {
  const cairoHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }).format(new Date()),
    10
  );
  return cairoHour === TARGET_CAIRO_HOUR;
}

// Triggered hourly by Vercel Cron (see vercel.json); only actually runs the
// snapshot once it's ~3 AM Cairo time. Pass ?force=true to bypass the hour
// check for manual testing.
router.all("/daily-snapshot", async (req, res) => {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  if (req.query.force !== "true" && !isCairoTargetHour()) {
    return res.json({ ok: true, skipped: true, reason: "notTargetHour" });
  }
  try {
    await takeDailySnapshot();
    res.json({ ok: true });
  } catch (err) {
    console.error("daily-snapshot cron error:", err);
    res.status(500).json({ ok: false, error: "cronFailed" });
  }
});

// The router remains the default export used by app.js. isCairoTargetHour is
// attached as a property purely so it can be unit tested in isolation.
module.exports = router;
module.exports.isCairoTargetHour = isCairoTargetHour;
