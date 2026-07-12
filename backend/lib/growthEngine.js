// ══════════════════════════════════════════════════════
//  Growth models shared with the frontend (see docs/js/return-config.js
//  for the full rationale). Mirrors:
//    - PERIODIC-BOUNDARY COMPOUNDING: simple interest within a period
//      (principal × rate/365 × days), only folded into the balance at each
//      real payout boundary (e.g. Mashreq-style monthly savings).
//    - FLAT SIMPLE INTEREST: compounding: false — interest paid out rather
//      than reinvested, so the item's own balance never grows here.
//    - Fallback: original continuous daily compounding, unchanged, for
//      items with no return category or a genuinely daily payout.
// ══════════════════════════════════════════════════════

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetweenDates(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
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
// falls mid-period (i.e. nothing should be posted for that day).
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

/**
 * Returns the interest to add to `qty` for `todayStr`, given the item's
 * `apy` and `returnConfig`, or null if nothing should be posted today
 * (e.g. mid-month for a periodic-boundary product — it isn't payout day yet).
 *
 * `cfg` is the item's returnConfig entry (may be undefined/empty).
 */
function dailyGrowthDelta(qty, apyPercent, cfg, todayStr) {
  const rate = apyPercent || 0;
  if (!rate || !qty) return null;
  const today = parseDateStr(todayStr);
  const config = cfg || {};

  // Tiered certificates aren't auto-grown day to day by the cron today
  // either way (unchanged legacy behaviour) — skip explicit handling here.

  const monthsStep = monthsStepForFreq(config.payoutFreq);
  if (config.startDate && monthsStep && config.compounding === true) {
    const periodStart = periodBoundaryAt(config.startDate, monthsStep, today);
    if (!periodStart) return null; // not a payout day — balance stays flat, as it should
    const days = daysBetweenDates(periodStart, today);
    return qty * (rate / 100 / 365) * days;
  }

  if (config.compounding === false) {
    // Interest is paid out elsewhere, not reinvested here — this item's own
    // balance shouldn't auto-grow at all.
    return null;
  }

  // Fallback: original continuous daily compounding for items with no
  // return category configured, or a genuinely daily payout/compounding.
  const dailyRate = Math.pow(1 + rate / 100, 1 / 365) - 1;
  return qty * dailyRate;
}

module.exports = { dailyGrowthDelta, monthsStepForFreq, periodBoundaryAt, parseDateStr, daysBetweenDates };
