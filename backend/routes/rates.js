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

// S&P 500 daily closes from Yahoo Finance's public chart API — free, no key required.
// (Previously used stooq.com, which started blocking non-browser requests.)
router.get("/benchmark", async (req, res) => {
  try {
    const period1 = Math.floor(new Date(String(req.query.from)).getTime() / 1000);
    const period2 = Math.floor(new Date(String(req.query.to)).getTime() / 1000) + 86400;
    if (!period1 || !period2) return res.json({ ok: false, error: "invalidDate" });

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?period1=${period1}&period2=${period2}&interval=1d`;
    const apiRes = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const json = await apiRes.json();

    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;
    if (!timestamps || !closes) return res.json({ ok: false, error: "benchmarkUnavailable" });

    const series = timestamps
      .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] }))
      .filter((p) => typeof p.close === "number");

    if (series.length === 0) return res.json({ ok: false, error: "benchmarkUnavailable" });
    res.json({ ok: true, series });
  } catch (err) {
    console.error("benchmark error:", err);
    res.json({ ok: false, error: "benchmarkUnavailable" });
  }
});

module.exports = router;
