// ══════════════════════════════════════════════════════════════════════════
//  growthPipeline.js — SINGLE SOURCE OF TRUTH for every interest/return
//  calculation in Kanz.
//
//  This exact file is used by:
//    - the backend (required by growthEngine.js / the nightly cron)
//    - the frontend (loaded as a plain <script> tag — see docs/js/growth-pipeline.js,
//      which MUST be an exact copy of this file; run `npm run sync-pipeline`
//      after editing this file, before committing/pushing)
//
//  Previously this math was hand-duplicated in THREE places (backend
//  growthEngine.js, docs/js/return-config.js, docs/js/simulator.js) and kept
//  in sync manually. Any future fix now happens once, here.
//
//  ── How an item's return is actually calculated ─────────────────────────
//  `returnConfig[itemId]` fields and what they control:
//    - calcMethod:   labels *how* interest is computed. Authoritative only in
//                    the one case where nothing else disambiguates it (a flat
//                    item with no payout schedule) — see calculateFlatInterest.
//                    For scheduled items, the actual formula is fully
//                    determined by payoutFreq + compounding + startDate below;
//                    calcMethod is kept in sync with those (see
//                    deriveReturnCategory in return-config.js) for display,
//                    but does not re-decide the branch on its own — this
//                    avoids changing behaviour for existing saved items whose
//                    calcMethod label may predate this field being meaningful.
//    - rateBasis:    whether the stored `apy` % is a Nominal APR (simple
//                    annual rate, unaffected by compounding frequency — the
//                    convention most Egyptian banks quote) or an Effective
//                    APY/EAR (the true annual yield with compounding already
//                    folded in — e.g. Thndr). Converted via
//                    nominalToEffective/effectiveToNominal below.
//    - compounding:  true  → interest folds back into the item's own balance
//                    false → interest is paid out elsewhere; this item's
//                            balance never grows from it directly
//    - payoutFreq:   when a scheduled payout actually happens (monthly /
//                    quarterly / semiAnnual / annual / maturity / daily)
//    - startDate:    the anchor date payout boundaries are counted from
//    - growthFormula: an optional user-written override for the per-segment
//                    interest formula (principal, rate, days) => amount
//    - tierRates:    step-up certificate: a different rate each year,
//                    starting from startDate
// ══════════════════════════════════════════════════════════════════════════

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetweenDates(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
}

function addYearsToDate(d, n) {
  return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
}

function monthsStepForFreq(payoutFreq) {
  if (payoutFreq === "monthly") return 1;
  if (payoutFreq === "quarterly") return 3;
  if (payoutFreq === "semiAnnual") return 6;
  if (payoutFreq === "annual" || payoutFreq === "maturity") return 12;
  return null;
}

// Walks forward in `monthsStep` jumps from `startDateStr` (anchored to its
// day-of-month) until it exactly reaches `dateObj`. Returns the boundary
// just before `dateObj` if `dateObj` IS a boundary, or null if `dateObj`
// falls mid-period (i.e. nothing should be posted for that day). Used by the
// daily cron, which only ever needs to know "is today a payout day".
function periodBoundaryAt(startDateStr, monthsStep, dateObj) {
  if (!startDateStr || !monthsStep) return null;
  let cursor = parseDateStr(startDateStr);
  if (dateObj <= cursor) return null;
  let prev = cursor;
  while (cursor < dateObj) {
    prev = cursor;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  return cursor.getTime() === dateObj.getTime() ? prev : null;
}

// Like periodBoundaryAt, but for projecting from an arbitrary `at` date that
// may fall mid-period (the table/simulator project from "today", which is
// essentially never exactly a payout day) — returns the period boundary
// at-or-before `at`, walking backwards through anniversaries if the anchor
// date itself is still in the future relative to `at`.
function periodStartAtOrBefore(startDateStr, monthsStep, at) {
  let cursor = parseDateStr(startDateStr);
  if (cursor > at) {
    while (cursor > at) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - monthsStep, cursor.getDate());
    }
    return cursor;
  }
  let prev = cursor;
  while (cursor <= at) {
    prev = cursor;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  return prev;
}

// Next date that is startDateStr + N*monthsStep (integer N), strictly after
// `after`. Anchors "next payout" to the account's actual opening date.
function anniversaryAfter(startDateStr, monthsStep, after) {
  let cursor = parseDateStr(startDateStr);
  if (cursor > after) return cursor;
  while (cursor <= after) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  return cursor;
}

// Evaluates a user-written formula (returnConfig[id].growthFormula) against
// {principal, rate, days}, returning the interest amount, or null if the
// formula is empty/invalid — callers fall back to the built-in default.
// This is a single-user personal app — the formula an account owner writes
// only ever runs against their own data — so a plain expression evaluator is
// an acceptable trade for "you can fix the math yourself, no code change".
function evalGrowthFormula(formula, principal, rate, days) {
  if (!formula || !String(formula).trim()) return null;
  try {
    const fn = new Function("principal", "rate", "days", `"use strict"; return (${formula});`);
    const result = fn(principal, rate, days);
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  } catch (_err) {
    return null;
  }
}

// Interest for one segment (principal, rate%, days days) — the item's custom
// formula if it has one, otherwise the built-in simple-interest default
// (principal × rate/100/365 × days, the "Bank Engine" formula).
function segmentInterest(cfg, principal, ratePercent, days) {
  const custom = cfg && cfg.growthFormula ? evalGrowthFormula(cfg.growthFormula, principal, ratePercent, days) : null;
  return custom != null ? custom : principal * (ratePercent / 100 / 365) * days;
}

// Converts between a Nominal APR (simple annual rate, unaffected by how
// often it compounds) and an Effective APY/EAR (the true annual yield once
// compounding at `m` times a year is folded in). Identical at m=1.
function nominalToEffective(nominalPct, m) {
  if (!(m > 1)) return nominalPct;
  return (Math.pow(1 + nominalPct / 100 / m, m) - 1) * 100;
}
function effectiveToNominal(effectivePct, m) {
  if (!(m > 1)) return effectivePct;
  return (Math.pow(1 + effectivePct / 100, 1 / m) - 1) * m * 100;
}

// Compounds `principal` forward from `fromDate` to `targetDate`, folding
// interest back into the running balance at every real payout boundary
// ("Bank Engine" — e.g. Mashreq-style monthly savings). Only used for
// compounding===true items — see calculateScheduledInterest.
//
// `assumeContinuous` distinguishes two different questions callers ask:
//   - true  (table projections): `principal` is the item's REAL current
//     balance, which has genuinely been sitting there — and accruing,
//     un-posted — since the period's real start, not just since `fromDate`
//     (`fromDate` there is only ever "today"). The currently-open period
//     must be counted in full from its true start, or the projection
//     undercounts exactly what the cron will actually post at the boundary.
//   - false (simulator, default): `principal` is a hypothetical amount that
//     only starts existing at `fromDate` (a custom date/amount the user is
//     testing) — it cannot have earned interest before it existed, even if
//     the item's real Since-date implies an earlier period start.
function periodicBoundaryValueAt(
  principal,
  startDateStr,
  ratePercent,
  payoutFreq,
  fromDate,
  targetDate,
  cfg,
  assumeContinuous
) {
  const monthsStep = monthsStepForFreq(payoutFreq);
  if (!startDateStr || !monthsStep || !ratePercent || targetDate <= fromDate) return principal;

  let balance = principal;
  const periodStart = periodStartAtOrBefore(startDateStr, monthsStep, fromDate);
  // periodStart is always at-or-before fromDate by construction — so this
  // is a no-op (cursor = fromDate) when assumeContinuous is false.
  let cursor = assumeContinuous ? periodStart : fromDate;
  let nextBoundary = new Date(periodStart.getFullYear(), periodStart.getMonth() + monthsStep, periodStart.getDate());

  while (nextBoundary <= targetDate) {
    const days = daysBetweenDates(cursor, nextBoundary);
    balance += segmentInterest(cfg, balance, ratePercent, days);
    cursor = nextBoundary;
    nextBoundary = new Date(cursor.getFullYear(), cursor.getMonth() + monthsStep, cursor.getDate());
  }
  const remDays = Math.max(0, daysBetweenDates(cursor, targetDate));
  if (remDays > 0) balance += segmentInterest(cfg, balance, ratePercent, remDays);
  return balance;
}

// Plain simple interest off the ORIGINAL principal, never compounded across
// periods — "Certificate Engine": for products where interest is paid out
// rather than reinvested into this same balance.
function simpleFlatValueAt(principal, ratePercent, fromDate, targetDate, cfg) {
  if (!ratePercent || targetDate <= fromDate) return principal;
  const days = daysBetweenDates(fromDate, targetDate);
  return principal + segmentInterest(cfg, principal, ratePercent, days);
}

// Step-up certificate: compounds from startDateStr, switching to the next
// rate in tierRates at every anniversary. Past the last tier, keeps
// compounding at that last tier's rate.
function tieredValueAt(principal, startDateStr, tierRates, targetDate) {
  if (!startDateStr || !Array.isArray(tierRates) || !tierRates.length) return principal;
  let cursor = parseDateStr(startDateStr);
  if (targetDate <= cursor) return principal;

  let value = principal;
  for (let i = 0; i < tierRates.length; i++) {
    const yearEnd = addYearsToDate(cursor, 1);
    const segmentEnd = targetDate < yearEnd ? targetDate : yearEnd;
    const days = Math.max(0, daysBetweenDates(cursor, segmentEnd));
    value *= Math.pow(1 + tierRates[i] / 100, days / 365);
    if (targetDate <= yearEnd) return value;
    cursor = yearEnd;
  }
  const lastRate = tierRates[tierRates.length - 1];
  const remDays = Math.max(0, daysBetweenDates(cursor, targetDate));
  return value * Math.pow(1 + lastRate / 100, remDays / 365);
}

// ── The one projection entry point, used by BOTH the table's projection
// columns and the simulator (via an explicit rateBasis override) ──────────
// `basisOverride`, when given, replaces cfg.rateBasis (the simulator's
// APY/APR toggle re-runs this exact math under the other interpretation
// without touching the item's saved config).
function projectValueAt(principal, rate, cfg, fromDate, targetDate, basisOverride, assumeContinuous) {
  if (!principal || targetDate <= fromDate) return principal;
  const config = cfg || {};

  if (config.startDate && Array.isArray(config.tierRates) && config.tierRates.length) {
    return tieredValueAt(principal, config.startDate, config.tierRates, targetDate);
  }
  if (!rate) return principal;

  const basis = basisOverride || config.rateBasis;
  const monthsStep = monthsStepForFreq(config.payoutFreq);

  if (config.startDate && monthsStep && config.compounding === true) {
    // periodicBoundaryValueAt's internal math is simple/nominal-style
    // (rate/365 × days). If the stored number is actually an Effective
    // APY/EAR, convert it down to this product's own compounding frequency
    // first, so the per-period simple interest still adds up to the
    // effective annual yield the user actually has.
    const periodsPerYear = 12 / monthsStep;
    const nominalRate = basis === "effective" ? effectiveToNominal(rate, periodsPerYear) : rate;
    return periodicBoundaryValueAt(
      principal,
      config.startDate,
      nominalRate,
      config.payoutFreq,
      fromDate,
      targetDate,
      config,
      !!assumeContinuous
    );
  }

  // Flat cases below are never auto-grown by the daily cron (a compounding:
  // false product isn't reinvested, and a custom formula outside a period
  // structure isn't posted automatically either) — so `principal` here is
  // NOT already "as of today". Anchor to the item's own "since" date if set.
  const flatBasisDate = config.startDate ? parseDateStr(config.startDate) : fromDate;

  if (config.growthFormula) {
    const days = Math.max(0, daysBetweenDates(flatBasisDate, targetDate));
    return principal + segmentInterest(config, principal, rate, days);
  }

  // Flat, no period structure: this is the one case where calcMethod is the
  // deciding signal (compounding alone can't tell "certificate, never
  // reinvest" apart from "no schedule configured yet"). fixedPrincipal
  // always means simple interest off the original principal.
  if (config.calcMethod === "fixedPrincipal" || config.compounding === false) {
    return simpleFlatValueAt(principal, rate, flatBasisDate, targetDate, config);
  }

  // Fallback: continuous daily compounding (dailyBalance / navBased / no
  // return category configured). The daily cron already grows this item's
  // qty every day, so `principal` here IS already "as of today" — always
  // accrue from `fromDate`, never `startDate`.
  const effectiveRate = basis === "nominal" ? nominalToEffective(rate, 365) : rate;
  const days = Math.max(0, daysBetweenDates(fromDate, targetDate));
  return principal * Math.pow(1 + effectiveRate / 100, days / 365);
}

// ── Backend cron entry point ────────────────────────────────────────────
// Returns the interest to post for `todayStr`, or null if nothing should be
// posted today. Return shape:
//   { amount, reinvest: true }   → add `amount` to qty AND log it
//   { amount, reinvest: false }  → do NOT touch qty, but still log `amount`
//                                  as interest earned today (paid out
//                                  elsewhere — e.g. a certificate's coupon)
//   null                         → not a payout day / nothing configured
//
// FIX vs the old growthEngine.js: compounding:false items with a real
// payout schedule (startDate + payoutFreq) used to return null outright —
// meaning a certificate's interest was never computed OR logged anywhere,
// even though the table showed a (misleading) non-zero projection for it.
// Now the interest is always computed and logged on the real payout day;
// only whether it folds back into `qty` depends on `compounding`.
function dailyGrowthDelta(qty, apyPercent, cfg, todayStr) {
  const rate = apyPercent || 0;
  if (!rate || !qty) return null;
  const today = parseDateStr(todayStr);
  const config = cfg || {};

  // Tiered certificates aren't auto-posted day to day by the cron either way
  // (unchanged legacy behaviour — anniversaries are wide apart, best
  // reviewed by hand rather than silently posted).
  if (config.startDate && Array.isArray(config.tierRates) && config.tierRates.length) return null;

  const monthsStep = monthsStepForFreq(config.payoutFreq);
  if (config.startDate && monthsStep && (config.compounding === true || config.compounding === false)) {
    const periodStart = periodBoundaryAt(config.startDate, monthsStep, today);
    if (!periodStart) return null; // not a payout day yet — balance stays flat
    const days = daysBetweenDates(periodStart, today);
    const periodsPerYear = 12 / monthsStep;
    const nominalRate = config.rateBasis === "effective" ? effectiveToNominal(rate, periodsPerYear) : rate;
    const amount = segmentInterest(config, qty, nominalRate, days);
    return { amount, reinvest: config.compounding === true };
  }

  if (config.growthFormula) {
    // No period structure configured, but a custom formula exists — the
    // cron runs once a day, so this posts one day's worth of interest.
    return { amount: segmentInterest(config, qty, rate, 1), reinvest: config.compounding !== false };
  }

  if (config.compounding === false) {
    // No period structure to anchor a real payout date to — nothing safe to
    // auto-post daily. The item's own projection (projectValueAt above)
    // still shows the informational "if left running" estimate in the UI;
    // this just means the stored balance/history isn't auto-updated for it.
    return null;
  }

  // Fallback: continuous daily compounding for items with no return
  // category configured, or a genuinely daily payout/compounding.
  const effectiveRate = config.rateBasis === "nominal" ? nominalToEffective(rate, 365) : rate;
  const dailyRate = Math.pow(1 + effectiveRate / 100, 1 / 365) - 1;
  return { amount: qty * dailyRate, reinvest: true };
}

const GrowthPipeline = {
  parseDateStr,
  daysBetweenDates,
  addYearsToDate,
  monthsStepForFreq,
  periodBoundaryAt,
  periodStartAtOrBefore,
  anniversaryAfter,
  evalGrowthFormula,
  segmentInterest,
  nominalToEffective,
  effectiveToNominal,
  periodicBoundaryValueAt,
  simpleFlatValueAt,
  tieredValueAt,
  projectValueAt,
  dailyGrowthDelta,
};

// Node (backend / cron): export as a module.
// Browser (docs/js/growth-pipeline.js, an exact copy of this file): also
// attach every function to the global scope directly, so existing call
// sites (computeGrowthValueAt, monthsStepForFreq, etc. called as bare
// globals throughout return-config.js / simulator.js / render.js) keep
// working unchanged.
if (typeof module !== "undefined" && module.exports) {
  module.exports = GrowthPipeline;
} else {
  Object.assign(globalThis, GrowthPipeline);
}
