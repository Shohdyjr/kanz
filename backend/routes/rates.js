const express = require("express");
const router = express.Router();

// GET /api/historical-rate?date=YYYY-MM-DD
router.get("/historical-rate", async (req, res) => {
  const dateStr = req.query.date;
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.json({ ok: false, error: "invalidDate" });
  }

  try {
    const apiKey = process.env.APILAYER_KEY;
    if (!apiKey) return res.json({ ok: false, error: "genericError" });

    // الخطة المجانية من APILayer بتقفل الـ base currency على اليورو بس،
    // فبنجيب EUR→USD و EUR→EGP في نفس الطلب ونحسب سعر الجنيه للدولار يدوي.
    const url = `https://api.apilayer.com/exchangerates_data/${dateStr}?symbols=USD,EGP`;
    const apiRes = await fetch(url, { headers: { apikey: apiKey } });
    const json = await apiRes.json();

    if (!apiRes.ok || !json.success || !json.rates || !json.rates.EGP || !json.rates.USD) {
      const info = (json.error && (json.error.info || json.error.type)) || json.message || `HTTP ${apiRes.status}`;
      return res.json({ ok: false, error: info });
    }

    const egpPerUsd = json.rates.EGP / json.rates.USD;
    res.json({ ok: true, date: dateStr, egpPerUsd });
  } catch (err) {
    console.error("historical-rate error:", err);
    res.json({ ok: false, error: "connectionError" });
  }
});

// GET /api/benchmark?from=YYYY-MM-DD&to=YYYY-MM-DD  (مؤشر S&P 500 من stooq.com — مجاني وبلا مفتاح)
router.get("/benchmark", async (req, res) => {
  try {
    const { from, to } = req.query;
    const f = String(from || "").replace(/-/g, "");
    const t = String(to || "").replace(/-/g, "");
    const url = `https://stooq.com/q/d/l/?s=^spx&d1=${f}&d2=${t}&i=d`;
    const apiRes = await fetch(url);
    const text = await apiRes.text();

    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && l.indexOf("Date") !== 0);
    const series = lines
      .map((l) => {
        const parts = l.split(",");
        return { date: parts[0], close: parseFloat(parts[4]) };
      })
      .filter((p) => p.date && !isNaN(p.close));

    if (series.length === 0) return res.json({ ok: false, error: "benchmarkUnavailable" });
    res.json({ ok: true, series });
  } catch (err) {
    res.json({ ok: false, error: "benchmarkUnavailable" });
  }
});

module.exports = router;
