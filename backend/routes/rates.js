const express = require("express");
const env = require("../config/env");

const router = express.Router();

router.get("/historical-rate", async (req, res) => {
  const dateStr = req.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || "")) return res.json({ ok: false, error: "invalidDate" });
  if (!env.apiLayerKey) return res.json({ ok: false, error: "genericError" });

  try {
    // Free-tier APILayer plans lock the base currency to EUR, so we fetch
    // EUR→USD and EUR→EGP together and derive EGP/USD ourselves.
    const url = `https://api.apilayer.com/exchangerates_data/${dateStr}?symbols=USD,EGP`;
    const apiRes = await fetch(url, { headers: { apikey: env.apiLayerKey } });
    const json = await apiRes.json();

    if (!apiRes.ok || !json.success || !json.rates?.EGP || !json.rates?.USD) {
      return res.json({ ok: false, error: json.error?.info || json.error?.type || `HTTP ${apiRes.status}` });
    }
    res.json({ ok: true, date: dateStr, egpPerUsd: json.rates.EGP / json.rates.USD });
  } catch (err) {
    console.error("historical-rate error:", err);
    res.json({ ok: false, error: "connectionError" });
  }
});

// S&P 500 daily closes from stooq.com — free, no API key required.
router.get("/benchmark", async (req, res) => {
  try {
    const from = String(req.query.from || "").replace(/-/g, "");
    const to = String(req.query.to || "").replace(/-/g, "");
    const apiRes = await fetch(`https://stooq.com/q/d/l/?s=^spx&d1=${from}&d2=${to}&i=d`);
    const text = await apiRes.text();

    const series = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("Date"))
      .map((l) => {
        const [date, , , , close] = l.split(",");
        return { date, close: parseFloat(close) };
      })
      .filter((p) => p.date && !isNaN(p.close));

    if (series.length === 0) return res.json({ ok: false, error: "benchmarkUnavailable" });
    res.json({ ok: true, series });
  } catch {
    res.json({ ok: false, error: "benchmarkUnavailable" });
  }
});

module.exports = router;
