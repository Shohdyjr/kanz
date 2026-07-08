const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../lib/auth");

const router = express.Router();
// IMPORTANT: this router is mounted at "/api" in app.js, and requireAuth below
// applies to every path that reaches it. It must be the LAST "/api"-mounted
// router in app.js, after any public routes (cron, rates) — otherwise those
// public endpoints get incorrectly blocked by this auth check.
router.use(requireAuth);

/** Rejects `__proto__`/`constructor`/`prototype` keys to prevent prototype pollution. */
const isSafePlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  !("__proto__" in v) && !("constructor" in v) && !("prototype" in v);

async function getUserRow(username) {
  const { rows } = await pool.query("SELECT data, history FROM kanz_users WHERE username = $1", [username]);
  return rows[0] || null;
}

router.get("/data", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const d = user.data || {};
  res.json({
    ok: true,
    data: d.qty || {},
    customAssets: d.customAssets || [],
    excludedBaseIds: d.excludedBaseIds || [],
    baseOverrides: d.baseOverrides || {},
    theme: d.theme || "dark",
    lang: d.lang || "en",
    order: d.order || [],
    savingsGoal: d.savingsGoal || 0,
    priceAlerts: d.priceAlerts || null,
  });
});

router.put("/data", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const { qty, customAssets, excludedBaseIds, baseOverrides, theme, lang, order, savingsGoal } = req.body;
  if (qty !== undefined && !isSafePlainObject(qty)) return res.json({ ok: false, error: "invalidData" });
  if (baseOverrides !== undefined && !isSafePlainObject(baseOverrides)) return res.json({ ok: false, error: "invalidData" });

  const existing = user.data || {};
  const updated = {
    ...existing,
    qty: qty || {},
    customAssets: Array.isArray(customAssets) ? customAssets : existing.customAssets || [],
    excludedBaseIds: Array.isArray(excludedBaseIds) ? excludedBaseIds : existing.excludedBaseIds || [],
    baseOverrides: baseOverrides || existing.baseOverrides || {},
    theme: theme || existing.theme || "dark",
    lang: lang || existing.lang || "en",
    order: Array.isArray(order) ? order : existing.order || [],
    savingsGoal: typeof savingsGoal === "number" ? savingsGoal : existing.savingsGoal || 0,
  };

  await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(updated), req.username]);
  res.json({ ok: true });
});

router.get("/history", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });
  res.json({ ok: true, history: user.history || [] });
});

router.post("/history", async (req, res) => {
  const entry = req.body.entry;
  if (!entry?.date) return res.json({ ok: false, error: "missingData" });

  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const snapshot = {
    date: entry.date,
    egpUsd: +entry.egpUsd || 0,
    hardUsd: +entry.hardUsd || 0,
    goldUsd: +entry.goldUsd || 0,
    assetsUsd: +entry.assetsUsd || 0,
  };
  snapshot.totalUsd = snapshot.egpUsd + snapshot.hardUsd + snapshot.goldUsd + snapshot.assetsUsd;

  const history = user.history || [];
  const idx = history.findIndex((h) => h.date === snapshot.date);
  idx >= 0 ? (history[idx] = snapshot) : history.push(snapshot);
  history.sort((a, b) => a.date.localeCompare(b.date));

  await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(history), req.username]);
  res.json({ ok: true });
});

router.delete("/history", async (req, res) => {
  const date = req.body.date;
  if (!date) return res.json({ ok: false, error: "invalidDate" });

  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const history = (user.history || []).filter((h) => h.date !== date);
  await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(history), req.username]);
  res.json({ ok: true, history });
});

router.post("/alerts", async (req, res) => {
  const settings = req.body.settings || {};
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const data = {
    ...(user.data || {}),
    priceAlerts: {
      email: settings.email || "",
      goldTarget: +settings.goldTarget || 0,
      usdEgpTarget: +settings.usdEgpTarget || 0,
      goldFired: false,
      usdEgpFired: false,
    },
  };

  await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(data), req.username]);
  res.json({ ok: true });
});

module.exports = router;
