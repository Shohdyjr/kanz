const express = require("express");
const env = require("../config/env");
const { safeEqual } = require("../lib/auth");
const { takeDailySnapshot } = require("../cron/dailySnapshot");
const { checkPriceAlerts } = require("../cron/priceAlerts");

const router = express.Router();

// Triggered by Vercel Cron once a day (see vercel.json).
router.all("/daily-snapshot", async (req, res) => {
  try {
    await takeDailySnapshot();
    res.json({ ok: true });
  } catch (err) {
    console.error("daily-snapshot cron error:", err);
    res.status(500).json({ ok: false, error: "cronFailed" });
  }
});

// Triggered by an external scheduler (e.g. cron-job.org) every 3 hours, since
// Vercel's free tier only allows one built-in cron run per day.
router.all("/price-alerts", async (req, res) => {
  if (env.cronSecret && !safeEqual(req.query.secret || "", env.cronSecret)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  try {
    await checkPriceAlerts();
    res.json({ ok: true });
  } catch (err) {
    console.error("price-alerts cron error:", err);
    res.status(500).json({ ok: false, error: "cronFailed" });
  }
});

module.exports = router;
