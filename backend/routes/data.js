const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../lib/auth");

const router = express.Router();
router.use(requireAuth); // كل الراوتات هنا محمية بتوكن JWT

async function getUserRow(username) {
  const result = await pool.query("SELECT data, history FROM kanz_users WHERE username = $1", [username]);
  return result.rows[0] || null;
}

// GET /api/data
router.get("/data", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const d = user.data || {};
  res.json({
    ok: true,
    data:            d.qty             || {},
    customAssets:    d.customAssets    || [],
    excludedBaseIds: d.excludedBaseIds || [],
    baseOverrides:   d.baseOverrides   || {},
    theme:           d.theme           || "dark",
    lang:            d.lang            || "en",
    order:           d.order           || [],
    savingsGoal:     d.savingsGoal     || 0,
    priceAlerts:     d.priceAlerts     || null,
  });
});

// PUT /api/data
router.put("/data", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const existing = user.data || {};
  const { qty, customAssets, excludedBaseIds, baseOverrides, theme, lang, order, savingsGoal } = req.body;

  const updated = {
    ...existing, // نحافظ على أي حقول تانية زي priceAlerts قبل ما نكتب فوقها
    qty: qty || {},
    customAssets:    Array.isArray(customAssets)    ? customAssets    : (existing.customAssets    || []),
    excludedBaseIds: Array.isArray(excludedBaseIds) ? excludedBaseIds : (existing.excludedBaseIds || []),
    baseOverrides:   baseOverrides || existing.baseOverrides || {},
    theme:           theme || existing.theme || "dark",
    lang:            lang  || existing.lang  || "en",
    order:           Array.isArray(order) ? order : (existing.order || []),
    savingsGoal:     (typeof savingsGoal === "number") ? savingsGoal : (existing.savingsGoal || 0),
  };

  await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(updated), req.username]);
  res.json({ ok: true });
});

// GET /api/history
router.get("/history", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });
  res.json({ ok: true, history: user.history || [] });
});

// POST /api/history — إضافة/تعديل لقطة يدوية بتاريخ معيّن
router.post("/history", async (req, res) => {
  const entry = req.body.entry;
  if (!entry || !entry.date) return res.json({ ok: false, error: "missingData" });

  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const snapshot = {
    date:      entry.date,
    totalUsd:  (+entry.egpUsd || 0) + (+entry.hardUsd || 0) + (+entry.goldUsd || 0) + (+entry.assetsUsd || 0),
    egpUsd:    +entry.egpUsd    || 0,
    hardUsd:   +entry.hardUsd   || 0,
    goldUsd:   +entry.goldUsd   || 0,
    assetsUsd: +entry.assetsUsd || 0,
  };

  const history = user.history || [];
  const idx = history.findIndex((h) => h.date === snapshot.date);
  if (idx >= 0) history[idx] = snapshot; else history.push(snapshot);
  history.sort((a, b) => a.date.localeCompare(b.date));

  await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(history), req.username]);
  res.json({ ok: true });
});

// DELETE /api/history — بيمسح لقطة بتاريخ معيّن
router.delete("/history", async (req, res) => {
  const date = req.body.date;
  if (!date) return res.json({ ok: false, error: "invalidDate" });

  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const history = (user.history || []).filter((h) => h.date !== date);
  await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(history), req.username]);
  res.json({ ok: true, history });
});

// POST /api/alerts
router.post("/alerts", async (req, res) => {
  const settings = req.body.settings || {};
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const data = user.data || {};
  data.priceAlerts = {
    email:        settings.email        || "",
    goldTarget:   +settings.goldTarget  || 0,
    usdEgpTarget: +settings.usdEgpTarget|| 0,
    goldFired:    false,
    usdEgpFired:  false,
  };

  await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(data), req.username]);
  res.json({ ok: true });
});

module.exports = router;
