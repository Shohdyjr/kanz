const express = require("express");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const { requireAuth } = require("../lib/auth");
const { validate } = require("../lib/validate");
const growthPipeline = require("../lib/growthPipeline");
const { computeAttribution } = require("../lib/attribution");
const { BASE_ASSET_CURRENCY, priceForServerSide, fetchRatesServerSide } = require("../lib/rates");
const router = express.Router();

// All /api/data, /api/history, /api/activities endpoints are auth-gated;
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

// Descriptive/authoritative product-model fields — see backend/lib/growthPipeline.js
// for the full domain-model doc. Validated against the same enum options the
// UI offers, and cross-checked for internal consistency by
// growthPipeline.validateDomainModel (e.g. a NAV product can't also declare
// a cash distributionFrequency).
const RETURN_CONFIG_ENUMS = {
  productType: ["savings", "fixedDeposit", "certificate", "monthlyCertificate", "quarterlyCertificate", "maturityCertificate", "moneyMarketFund", "fixedIncomeFund", "investmentFund", "treasuryBill", "bond", "dividendFund", "goldFund", "etf", "stock"],
  rateType: ["fixed", "variable"],
  growthSource: ["fixedRate", "nav", "manual", "discount"],
  growthFrequency: ["daily", "monthly", "quarterly", "semiAnnual", "annual", "maturity"],
  distributionFrequency: ["none", "daily", "monthly", "quarterly", "annual", "maturity"],
  compoundingFrequency: ["none", "daily", "monthly", "quarterly", "semiAnnual", "annual", "maturity"],
  liquidityFrequency: ["daily", "weekly", "monthly", "quarterly", "maturity", "restricted"],
  balanceBasis: ["currentBalance", "fixedPrincipal"],
  // Whether the % rate stored in `apy` is the bank's quoted Nominal APR
  // (simple annual rate, the convention most Egyptian banks quote) or an
  // already-compounded Effective APY/EAR (common for money-market/fixed
  // income funds like Thndr).
  rateBasis: ["nominal", "effective"],
  // WHERE, within growthFrequency's own cadence, a Credit event actually
  // falls — see creditBoundaryAtOrBefore/nextCreditBoundary in
  // growthPipeline.js. "anniversary" (unset defaults here too) preserves
  // every existing config's behavior unchanged.
  creditAnchor: ["anniversary", "calendarPeriodEnd", "fixedDay"],
};
const RETURN_CONFIG_KEYS = [
  ...Object.keys(RETURN_CONFIG_ENUMS),
  "startDate",
  "tierRates",
  "growthFormula",
  "noReturn",
  "creditDay",
  "creditBusinessDayAdjust",
  // growthSource: "discount" only (Treasury Bills, zero-coupon bonds) —
  // see discountValueAt in growthPipeline.js.
  "faceValue",
  "purchasePrice",
  "maturityDate",
];
const RETURN_CONFIG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Regex only checks the shape (YYYY-MM-DD) — this also rejects dates that
// don't exist on the calendar (e.g. 2026-02-30), which the regex alone would
// let through and growthPipeline.js would then silently misinterpret via
// JS Date's auto-rollover (Feb 30 -> Mar 2).
const isRealCalendarDate = (dateStr) => {
  if (!RETURN_CONFIG_DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};
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

// A formula that fails to parse would otherwise just silently fall back to
// the default calculation the first time it's used (see evalGrowthFormula in
// growthPipeline.js) — catching it here means the save itself fails with a
// clear error, instead of the user only noticing days or weeks later that
// their custom formula was never actually being applied.
const isValidGrowthFormula = (formula) => {
  if (formula == null) return true;
  if (typeof formula !== "string" || formula.length > MAX_GROWTH_FORMULA_LEN) return false;
  if (!formula.trim()) return true;
  return growthPipeline.evalGrowthFormula(formula, 1000, 10, 30) != null;
};

const isValidReturnConfigEntry = (v) =>
  isSafePlainObject(v) &&
  Object.keys(v).every((k) => RETURN_CONFIG_KEYS.includes(k)) &&
  Object.entries(RETURN_CONFIG_ENUMS).every(([field, allowed]) => v[field] == null || allowed.includes(v[field])) &&
  (v.startDate == null || isRealCalendarDate(v.startDate)) &&
  (v.maturityDate == null || isRealCalendarDate(v.maturityDate)) &&
  (v.noReturn == null || typeof v.noReturn === "boolean") &&
  (v.creditBusinessDayAdjust == null || typeof v.creditBusinessDayAdjust === "boolean") &&
  (v.creditDay == null || (typeof v.creditDay === "number" && Number.isInteger(v.creditDay) && v.creditDay >= 1 && v.creditDay <= 31)) &&
  (v.faceValue == null || (typeof v.faceValue === "number" && Number.isFinite(v.faceValue) && v.faceValue > 0)) &&
  (v.purchasePrice == null || (typeof v.purchasePrice === "number" && Number.isFinite(v.purchasePrice) && v.purchasePrice > 0)) &&
  isValidGrowthFormula(v.growthFormula) &&
  isValidTierRates(v.tierRates) &&
  growthPipeline.validateDomainModel(v).valid;

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

// ── Activities (facts about intentional user actions) ──────────────────
// Generalized from the original `contributions` model — this column is now
// named `activities` to match (see backend/db/init.js for the rename
// migration). Every existing row already fits the generalized shape
// unchanged (an old entry with no `type` is treated as `income`/`expense`
// per its amount's sign — see inferLegacyType in lib/attribution.js).
//
// An Activity is a fact about ONE atomic action. Per Kanz's architecture
// principles it may carry fields intrinsic to that single action (a
// Transfer's `fromItemId`/`toItemId`, a Buy's `assetItemId`/`fundingItemId`)
// but must NEVER reference another Activity — there is deliberately no
// `sourceActivityId`/`threadId`/parent field anywhere in this shape, and
// none should ever be added (see docs-dev/architecture-principles.md).
//
// "Contribution"/"contributed" is a separate, still-valid term used
// elsewhere (sumContributionsBetween, changeAnalysisExclContrib in
// docs/js/helpers.js + history-chart.js) for a derived financial figure —
// how much of a wealth change came from money the user added, vs the market
// moving on its own. That concept is distinct from this log and keeps its
// own name; only the log/entity itself was renamed to Activity.
async function getActivitiesRow(username) {
  const { rows } = await pool.query("SELECT activities FROM kanz_users WHERE username = $1", [username]);
  return rows[0] || null;
}

const isValidDateStr = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

router.get("/activities", async (req, res) => {
  const user = await getActivitiesRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });
  res.json({ ok: true, activities: user.activities || [] });
});

// Currencies the client's own FX rates (docs/js/helpers.js priceFor) can
// price — kept in sync with BASE_ASSET_CURRENCY's fiat entries in lib/rates.js.
const ACTIVITY_CURRENCIES = ["EGP", "USD", "EUR", "SAR"];

// The closed set of intents an Activity may express. Deliberately flat and
// small — see docs-dev/architecture-principles.md ("intent-driven actions").
// "income"/"expense" are kept only as the legacy two the old UI wrote;
// `salary`/`deposit`/`withdrawal` are their intent-driven replacements.
const ACTIVITY_TYPES = ["income", "expense", "salary", "deposit", "withdrawal", "buy", "sell", "transfer", "correction"];

function genActivityId() {
  return "act_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

router.post("/activities", async (req, res) => {
  const { ok, errors } = validate(req.body, {
    date: { type: "string", match: /^\d{4}-\d{2}-\d{2}$/ },
    amountUsd: { type: "number", finite: true, nonzero: true },
    note: { type: "string", optional: true, maxLength: 200 },
    // Both optional for backward compatibility with older clients that only
    // ever sent amountUsd — those entries are treated as plain USD (see the
    // fallbacks below), matching their original behavior exactly.
    currency: { type: "string", optional: true, match: /^(EGP|USD|EUR|SAR)$/ },
    amountOriginal: { type: "number", optional: true, finite: true },
    // New, all optional — see ACTIVITY_TYPES / file header above.
    type: { type: "string", optional: true },
    itemId: { type: "string", optional: true, maxLength: 100 },
    fromItemId: { type: "string", optional: true, maxLength: 100 },
    toItemId: { type: "string", optional: true, maxLength: 100 },
    assetItemId: { type: "string", optional: true, maxLength: 100 },
    fundingItemId: { type: "string", optional: true, maxLength: 100 },
  });
  if (!ok) return res.json({ ok: false, error: errors[0] || "invalidData" });

  const { date, amountUsd, note, currency, amountOriginal, type, itemId, fromItemId, toItemId, assetItemId, fundingItemId } =
    req.body;
  if (currency && !ACTIVITY_CURRENCIES.includes(currency)) return res.json({ ok: false, error: "invalidData" });
  if (type && !ACTIVITY_TYPES.includes(type)) return res.json({ ok: false, error: "invalidData" });
  // A Transfer/Buy/Sell describes exactly one action with two intrinsic
  // sides — require both sides together, never one alone, so a saved
  // Activity can't silently describe a half-finished action.
  if (type === "transfer" && (!fromItemId || !toItemId)) return res.json({ ok: false, error: "invalidData" });
  if (type === "buy" && (!assetItemId || !fundingItemId)) return res.json({ ok: false, error: "invalidData" });
  if (type === "sell" && (!assetItemId || !fundingItemId)) return res.json({ ok: false, error: "invalidData" });

  const user = await getActivitiesRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  // One Activity per (date, id) — legacy behavior (one entry per date,
  // replacing on re-save) is preserved for untyped/income/expense entries by
  // matching on date+no-id, as before. Typed activities get a stable id so
  // multiple can share a date (e.g. a Deposit and a Correction on the same
  // day) without clobbering each other.
  const activities = user.activities || [];
  const entry = {
    id: genActivityId(),
    date,
    amountUsd,
    note: typeof note === "string" ? note.slice(0, 200) : "",
    // amountOriginal/currency preserve what the user actually typed (e.g.
    // "5000 EGP") for display; amountUsd above remains the converted figure
    // every growth calculation already relies on, so nothing downstream changes.
    currency: currency || "USD",
    amountOriginal: typeof amountOriginal === "number" ? amountOriginal : amountUsd,
    type: type || undefined,
    itemId: itemId || undefined,
    fromItemId: fromItemId || undefined,
    toItemId: toItemId || undefined,
    assetItemId: assetItemId || undefined,
    fundingItemId: fundingItemId || undefined,
  };
  const legacyIdx = !type ? activities.findIndex((c) => c.date === date && !c.type) : -1;
  legacyIdx >= 0 ? (activities[legacyIdx] = entry) : activities.push(entry);
  activities.sort((a, b) => a.date.localeCompare(b.date));

  await pool.query("UPDATE kanz_users SET activities = $1 WHERE username = $2", [
    JSON.stringify(activities),
    req.username,
  ]);
  res.json({ ok: true, activity: entry });
});

router.delete("/activities", async (req, res) => {
  const { date, id } = req.body;
  if (!isValidDateStr(date)) return res.json({ ok: false, error: "invalidDate" });

  const user = await getActivitiesRow(req.username);
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  // If an id is given (typed Activities may share a date), delete that
  // specific entry; otherwise fall back to legacy date-only deletion.
  const activities = (user.activities || []).filter((c) => (id ? c.id !== id : c.date !== date));
  await pool.query("UPDATE kanz_users SET activities = $1 WHERE username = $2", [
    JSON.stringify(activities),
    req.username,
  ]);
  res.json({ ok: true, activities });
});

// ── Attribution (derived — see lib/attribution.js) ──────────────────────
// Pure read: recomputes the breakdown on every request from Snapshots +
// Activities + Item History. Nothing here is stored.
router.get("/attribution", async (req, res) => {
  const { from, to } = req.query;
  if (!isValidDateStr(from) || !isValidDateStr(to)) return res.json({ ok: false, error: "invalidDate" });

  const { rows } = await pool.query(
    "SELECT data, history, activities, item_history FROM kanz_users WHERE username = $1",
    [req.username]
  );
  const user = rows[0];
  if (!user) return res.json({ ok: false, error: "userNotFound" });

  // Same source of truth computeSnapshot() uses for pricing every item —
  // built here purely as a lookup, not a new fact.
  const customAssets = (user.data && user.data.customAssets) || [];
  const currencyById = { ...BASE_ASSET_CURRENCY };
  for (const c of customAssets) if (c && c.id && c.currency) currencyById[c.id] = c.currency;
  const itemCurrency = (itemId) => currencyById[itemId] || "USD";

  const result = computeAttribution(
    user.history || [],
    user.activities || [],
    user.item_history || [],
    from,
    to,
    itemCurrency,
    priceForServerSide
  );
  res.json({ ok: true, attribution: result });
});

// The router remains the default export used by app.js. isFiniteNumberMap and
// isValidDateStr are attached as properties purely so they can be unit tested in isolation.
module.exports = router;
module.exports.isFiniteNumberMap = isFiniteNumberMap;
module.exports.isValidDateStr = isValidDateStr;
module.exports.isValidReturnConfigMap = isValidReturnConfigMap;
