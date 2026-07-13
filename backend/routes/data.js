const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const { requireAuth } = require("../lib/auth");
const { validate } = require("../lib/validate");
const router = express.Router();

// All /api/data, /api/history, /api/contributions endpoints are auth-gated;
// this limiter is a second layer against token-leakage abuse — 100 reqs / 15 min.
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));

// IMPORTANT: this router is mounted at "/api" in app.js, and requireAuth below
// applies to every path that reaches it. It must be the LAST "/api"-mounted
// router in app.js, after any public routes (cron, rates) — otherwise those
// public endpoints get incorrectly blocked by this auth check.
router.use(requireAuth);

/**
 * Rejects objects with an own `__proto__`/`constructor`/`prototype` key to
 * prevent prototype pollution, without false-positiving on ordinary objects
 * (the `in` operator matches *inherited* properties too — every plain object
 * has an inherited `__proto__`/`constructor`, so it must not be used here).
 */
const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"];
const isSafePlainObject = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  DANGEROUS_KEYS.every((k) => !Object.prototype.hasOwnProperty.call(v, k));

/**
 * `qty` drives every money calculation on both the client and the daily
 * snapshot cron, so a non-finite value (NaN, Infinity, a stray string) saved
 * here would silently corrupt totals with no visible error. The client
 * already only ever sends real numbers (parseFloat(v) || 0), so this just
 * rejects anything that couldn't have come from a well-behaved client.
 */
const isFiniteNumberMap = (v) =>
  isSafePlainObject(v) && Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n));

// `qtyUpdatedAt` is purely informational (shown as a small "last update"
// subtext under each item's qty field) — never used in any calculation —
// but still validated as a map of asset id → YYYY-MM-DD string, same
// dangerous-key/type discipline as everything else stored here.
const QTY_UPDATED_AT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDateMap = (v) =>
  isSafePlainObject(v) && Object.values(v).every((d) => typeof d === "string" && QTY_UPDATED_AT_DATE_RE.test(d));

async function getUserRow(username) {
  const { rows } = await pool.query("SELECT data, history, item_history FROM kanz_users WHERE username = $1", [
    username,
  ]);
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
    apy: d.apy || {},
    returnConfig: d.returnConfig || {},
    qtyUpdatedAt: d.qtyUpdatedAt || {},
  });
});

// Sane bounds for a per-item APY: 0% (no growth) up to 100% is already an
// extremely generous ceiling for any real-world savings/investment product,
// and rejecting anything outside that range keeps a typo (e.g. 2000 instead
// of 20) from silently compounding a wildly wrong balance every night.
const isValidApyMap = (v) =>
  isSafePlainObject(v) &&
  Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100);

// Descriptive metadata only (see docs/js/return-config.js) — validated against
// the same enum options the UI offers, so this stays display-only data and
// can never grow into an arbitrary-object storage hole.
const RETURN_CONFIG_ENUMS = {
  productType: ["savings", "fixedDeposit", "certificate", "moneyMarketFund", "fixedIncomeFund", "investmentFund"],
  rateType: ["fixed", "variable"],
  calcMethod: ["dailyBalance", "lowestMonthlyBalance", "fixedPrincipal", "navBased"],
  payoutFreq: ["daily", "monthly", "quarterly", "semiAnnual", "annual", "maturity"],
  liquidity: ["daily", "monthly", "quarterly", "maturity", "restricted"],
  // Whether the % rate stored in `apy` is the bank's quoted Nominal APR
  // (simple annual rate, the convention most Egyptian banks quote) or an
  // already-compounded Effective APY/EAR (common for money-market/fixed
  // income funds like Thndr). Missing/null keeps the pre-existing implicit
  // assumption for whichever calc path applies (see growthEngine.js).
  rateBasis: ["nominal", "effective"],
};
const RETURN_CONFIG_KEYS = [
  ...Object.keys(RETURN_CONFIG_ENUMS),
  "compounding",
  "startDate",
  "tierRates",
  "growthFormula",
];
const RETURN_CONFIG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Capped well above any reasonable formula (the UI's textarea is two rows)
// so a save can't smuggle in something absurd, while leaving plenty of room
// for a real expression like "principal * (rate/100/365) * days".
const MAX_GROWTH_FORMULA_LEN = 500;
const isValidTierRates = (v) =>
  v == null ||
  (Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 15 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n) && n >= -100 && n <= 1000));

const isValidReturnConfigEntry = (v) =>
  isSafePlainObject(v) &&
  Object.keys(v).every((k) => RETURN_CONFIG_KEYS.includes(k)) &&
  Object.entries(RETURN_CONFIG_ENUMS).every(([field, allowed]) => v[field] == null || allowed.includes(v[field])) &&
  (v.compounding == null || typeof v.compounding === "boolean") &&
  (v.startDate == null || RETURN_CONFIG_DATE_RE.test(v.startDate)) &&
  (v.growthFormula == null ||
    (typeof v.growthFormula === "string" && v.growthFormula.length <= MAX_GROWTH_FORMULA_LEN)) &&
  isValidTierRates(v.tierRates);

const isValidReturnConfigMap = (v) => isSafePlainObject(v) && Object.values(v).every(isValidReturnConfigEntry);

router.put("/data", async (req, res) => {
  const user = await getUserRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const {
    qty,
    customAssets,
    excludedBaseIds,
    baseOverrides,
    theme,
    lang,
    order,
    savingsGoal,
    apy,
    returnConfig,
    qtyUpdatedAt,
  } = req.body;
  if (qty !== undefined && !isFiniteNumberMap(qty)) return res.json({ ok: false, error: "invalidData" });
  if (baseOverrides !== undefined && !isSafePlainObject(baseOverrides))
    return res.json({ ok: false, error: "invalidData" });
  if (apy !== undefined && !isValidApyMap(apy)) return res.json({ ok: false, error: "invalidData" });
  if (returnConfig !== undefined && !isValidReturnConfigMap(returnConfig))
    return res.json({ ok: false, error: "invalidData" });
  if (qtyUpdatedAt !== undefined && !isValidDateMap(qtyUpdatedAt)) return res.json({ ok: false, error: "invalidData" });

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
    apy: apy || existing.apy || {},
    returnConfig: returnConfig || existing.returnConfig || {},
    qtyUpdatedAt: qtyUpdatedAt || existing.qtyUpdatedAt || {},
  };

  await pool.query("UPDATE kanz_users SET data = $1 WHERE username = $2", [JSON.stringify(updated), req.username]);
  res.json({ ok: true });
});

// ── Item history (automatic, APY-driven) ───────────────────────────────
// One entry per (itemId, date), appended by the daily cron whenever an item
// has an apy set — see cron/dailySnapshot.js applyItemGrowth(). Read-only
// from the client's point of view; there is no POST/DELETE here on purpose.
router.get("/item-history", async (req, res) => {
  const { rows } = await pool.query("SELECT item_history FROM kanz_users WHERE username = $1", [req.username]);
  const user = rows[0];
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const all = user.item_history || [];
  const itemId = req.query.itemId;
  const filtered = itemId ? all.filter((e) => e.itemId === itemId) : all;
  res.json({ ok: true, itemHistory: filtered });
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

  // Keep the most recent 730 daily snapshots (2 years). The array is already
  // sorted ascending, so slicing from the end gives the newest entries.
  // This caps the JSONB column size so GET /history never returns an
  // unbounded payload even for very old accounts.
  const trimmed = history.length > 730 ? history.slice(-730) : history;

  await pool.query("UPDATE kanz_users SET history = $1 WHERE username = $2", [JSON.stringify(trimmed), req.username]);
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

// ── Contributions (net money manually added/withdrawn in a period) ─────
// Kept as their own table column (not mixed into `history`) so the client can
// subtract them from a wealth delta and isolate "real" growth — i.e. how much
// existing assets moved in value, separate from money the user simply added.
async function getContributionsRow(username) {
  const { rows } = await pool.query("SELECT contributions FROM kanz_users WHERE username = $1", [username]);
  return rows[0] || null;
}

const isValidDateStr = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

router.get("/contributions", async (req, res) => {
  const user = await getContributionsRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });
  res.json({ ok: true, contributions: user.contributions || [] });
});

// Currencies the client's own FX rates (docs/js/helpers.js priceFor) can
// price — kept in sync with BASE_ASSET_CURRENCY's fiat entries in lib/rates.js.
const CONTRIB_CURRENCIES = ["EGP", "USD", "EUR", "SAR"];

router.post("/contributions", async (req, res) => {
  const { ok, errors } = validate(req.body, {
    date: { type: "string", match: /^\d{4}-\d{2}-\d{2}$/ },
    amountUsd: { type: "number", finite: true, nonzero: true },
    note: { type: "string", optional: true, maxLength: 200 },
    // Both optional for backward compatibility with older clients that only
    // ever sent amountUsd — those entries are treated as plain USD (see the
    // fallbacks below), matching their original behavior exactly.
    currency: { type: "string", optional: true, match: /^(EGP|USD|EUR|SAR)$/ },
    amountOriginal: { type: "number", optional: true, finite: true },
  });
  if (!ok) return res.json({ ok: false, error: errors[0] || "invalidData" });

  const { date, amountUsd, note, currency, amountOriginal } = req.body;
  if (currency && !CONTRIB_CURRENCIES.includes(currency)) return res.json({ ok: false, error: "invalidData" });

  const user = await getContributionsRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  // One contribution entry per date — logging the same date again (e.g. the
  // user corrects a typo) replaces it rather than creating a duplicate.
  const contributions = user.contributions || [];
  const entry = {
    date,
    amountUsd,
    note: typeof note === "string" ? note.slice(0, 200) : "",
    // amountOriginal/currency preserve what the user actually typed (e.g.
    // "5000 EGP") for display; amountUsd above remains the converted figure
    // every growth calculation already relies on, so nothing downstream changes.
    currency: currency || "USD",
    amountOriginal: typeof amountOriginal === "number" ? amountOriginal : amountUsd,
  };
  const idx = contributions.findIndex((c) => c.date === date);
  idx >= 0 ? (contributions[idx] = entry) : contributions.push(entry);
  contributions.sort((a, b) => a.date.localeCompare(b.date));

  await pool.query("UPDATE kanz_users SET contributions = $1 WHERE username = $2", [
    JSON.stringify(contributions),
    req.username,
  ]);
  res.json({ ok: true });
});

router.delete("/contributions", async (req, res) => {
  const date = req.body.date;
  if (!isValidDateStr(date)) return res.json({ ok: false, error: "invalidDate" });

  const user = await getContributionsRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  const contributions = (user.contributions || []).filter((c) => c.date !== date);
  await pool.query("UPDATE kanz_users SET contributions = $1 WHERE username = $2", [
    JSON.stringify(contributions),
    req.username,
  ]);
  res.json({ ok: true, contributions });
});

// The router remains the default export used by app.js. isFiniteNumberMap and
// isValidDateStr are attached as properties purely so they can be unit tested in isolation.
module.exports = router;
module.exports.isFiniteNumberMap = isFiniteNumberMap;
module.exports.isValidDateStr = isValidDateStr;
module.exports.isValidReturnConfigMap = isValidReturnConfigMap;
