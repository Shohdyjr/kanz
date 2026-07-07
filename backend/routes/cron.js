const express = require("express");
const { takeDailySnapshot } = require("../cron/dailySnapshot");
const { checkPriceAlerts } = require("../cron/priceAlerts");

const router = express.Router();

// بيتنادى تلقائيًا من Vercel Cron (مرة يوميًا — مفعّل في vercel.json)
router.all("/daily-snapshot", async (req, res) => {
  try {
    await takeDailySnapshot();
    res.json({ ok: true });
  } catch (err) {
    console.error("daily-snapshot cron error:", err);
    res.status(500).json({ ok: false, error: "cronFailed" });
  }
});

// بيتنادى من خدمة خارجية مجانية (زي cron-job.org) كل 3 ساعات، لأن خطة Vercel
// المجانية بتسمح بمهمة Cron مدمجة مرة واحدة باليوم بس.
// لازم تحط ?secret=... في الرابط اللي هتحطه في cron-job.org (مش هيتحط في الكود
// نفسه عشان السر يفضل مخفي حتى لو الـ repo عام على GitHub).
router.all("/price-alerts", async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (expected && req.query.secret !== expected) {
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
