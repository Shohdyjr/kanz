/*
 * Financial Product Engine
 *
 * The only source of truth for return calculations.  This is deliberately a
 * tiny UMD-style file: GitHub Pages can load it as a normal script, while the
 * Node API can require the very same source file.  Products are data; neither
 * productType nor a bank name participates in any calculation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FinancialProductEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DAY_MS = 86400000;
  const FREQUENCIES = ["daily", "monthly", "quarterly", "semiAnnual", "yearly", "maturity"];
  const METHODS = ["dailyBalance", "lowestMonthlyBalance", "fixedPrincipal", "effectiveCompound"];

  function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const parts = value.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }
  function dateString(date) { return date.toISOString().slice(0, 10); }
  function addDays(date, count) { return new Date(date.getTime() + count * DAY_MS); }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / DAY_MS); }
  function addMonths(date, count) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return target;
  }
  function addYears(date, count) { return addMonths(date, count * 12); }
  function monthStep(frequency) {
    return { monthly: 1, quarterly: 3, semiAnnual: 6, yearly: 12 }[frequency] || null;
  }
  function canonicalFrequency(value, fallback) {
    if (value === "annual") return "yearly";
    return FREQUENCIES.includes(value) ? value : fallback;
  }

  // Converts legacy records without changing their displayed semantics.
  function normalizeConfig(raw) {
    const c = { ...(raw || {}) };
    if (c.calcMethod === "navBased") c.calcMethod = "effectiveCompound";
    if (!METHODS.includes(c.calcMethod)) c.calcMethod = "effectiveCompound";
    c.payoutFreq = canonicalFrequency(c.payoutFreq, "daily");
    c.accrualFrequency = canonicalFrequency(c.accrualFrequency, c.payoutFreq);
    c.rateBasis = c.rateBasis === "nominal" ? "nominal" : "effective";
    c.compounding = c.compounding !== false;
    return c;
  }

  function dailyRate(ratePercent, rateBasis) {
    const annual = Number(ratePercent) / 100;
    if (!Number.isFinite(annual) || annual <= 0) return 0;
    return rateBasis === "effective" ? Math.pow(1 + annual, 1 / 365) - 1 : annual / 365;
  }
  // Legacy formulas remain supported, but only as arithmetic expressions over
  // the documented numeric variables.  No property access, calls, strings or
  // globals are allowed, so a saved formula cannot execute server code.
  function formulaInterest(formula, principal, rate, days) {
    if (!formula || !/^[\d\s+\-*/%.()principalratedays]+$/.test(formula)) return null;
    try {
      const value = Function("principal", "rate", "days", `"use strict"; return (${formula});`)(principal, rate, days);
      return Number.isFinite(value) ? value : null;
    } catch (_error) { return null; }
  }
  function tierRate(config, fallbackRate, atDate) {
    if (!Array.isArray(config.tierRates) || !config.tierRates.length || !config.startDate) return fallbackRate;
    const start = parseDate(config.startDate);
    if (!start || atDate < start) return fallbackRate;
    const years = Math.max(0, Math.floor(daysBetween(start, atDate) / 365));
    return config.tierRates[Math.min(years, config.tierRates.length - 1)];
  }
  function isBoundary(date, config, frequency) {
    if (frequency === "daily") return true;
    if (frequency === "maturity") return !!config.maturityDate && dateString(date) === config.maturityDate;
    const step = monthStep(frequency);
    if (!step) return false;
    const anchor = parseDate(config.startDate);
    if (!anchor) {
      // Legacy configurations had no anchor. Calendar period ends preserve
      // their previous practical behaviour while making payout deterministic.
      if (frequency === "monthly") return addDays(date, 1).getUTCMonth() !== date.getUTCMonth();
      if (frequency === "quarterly") return [2, 5, 8, 11].includes(date.getUTCMonth()) && addDays(date, 1).getUTCMonth() !== date.getUTCMonth();
      if (frequency === "semiAnnual") return [5, 11].includes(date.getUTCMonth()) && addDays(date, 1).getUTCMonth() !== date.getUTCMonth();
      return date.getUTCMonth() === 11 && date.getUTCDate() === 31;
    }
    if (date <= anchor) return false;
    let cursor = anchor;
    while (cursor < date) cursor = addMonths(cursor, step);
    return cursor.getTime() === date.getTime();
  }
  function isHistoryDue(date, config) { return isBoundary(date, config, config.accrualFrequency); }
  function principalFor(config, balance, state) {
    if (config.calcMethod === "fixedPrincipal") return state.fixedPrincipal;
    if (config.calcMethod === "lowestMonthlyBalance") return state.periodMinimumBalance;
    return balance;
  }
  function createState(balance, config, asOfDate, existing) {
    const state = { ...(existing || {}) };
    if (!Number.isFinite(state.fixedPrincipal)) state.fixedPrincipal = balance;
    if (!Number.isFinite(state.periodMinimumBalance)) state.periodMinimumBalance = balance;
    if (!Number.isFinite(state.accruedInterest)) state.accruedInterest = 0;
    if (!Number.isFinite(state.pendingHistoryInterest)) state.pendingHistoryInterest = 0;
    if (!state.lastProcessedDate) state.lastProcessedDate = asOfDate;
    if (!state.periodStartDate) state.periodStartDate = asOfDate;
    return state;
  }

  /*
   * Advances a product one or more date-only days.  "actual" and
   * "projection" intentionally use the same pipeline; projection merely
   * starts from supplied in-memory state and never persists it.
   */
  function advance(input) {
    const config = normalizeConfig(input.config);
    const target = parseDate(input.toDate);
    const initialDate = input.fromDate || input.toDate;
    if (!target || !parseDate(initialDate)) throw new Error("FinancialProductEngine requires YYYY-MM-DD dates");
    let balance = Number(input.balance) || 0;
    const state = createState(balance, config, initialDate, input.state);
    let cursor = parseDate(state.lastProcessedDate);
    if (!cursor || cursor > target) cursor = parseDate(initialDate);
    const events = [];

    while (cursor < target) {
      const date = addDays(cursor, 1);
      const before = balance;
      if (config.calcMethod === "lowestMonthlyBalance") state.periodMinimumBalance = Math.min(state.periodMinimumBalance, before);
      const annualRate = tierRate(config, input.ratePercent, date);
      const principal = principalFor(config, before, state);
      const formulaValue = formulaInterest(config.growthFormula, principal, annualRate, 1);
      const accruedToday = formulaValue == null ? principal * dailyRate(annualRate, config.rateBasis) : formulaValue;
      state.accruedInterest += Number.isFinite(accruedToday) ? accruedToday : 0;
      state.pendingHistoryInterest += Number.isFinite(accruedToday) ? accruedToday : 0;
      const payoutDue = isBoundary(date, config, config.payoutFreq);
      let paidOut = 0;
      let capitalized = 0;
      if (payoutDue && state.accruedInterest) {
        if (config.compounding) {
          capitalized = state.accruedInterest;
          balance += capitalized;
        } else {
          paidOut = state.accruedInterest;
        }
        state.accruedInterest = 0;
        state.periodMinimumBalance = balance;
        state.periodStartDate = dateString(date);
      }
      if (isHistoryDue(date, config) || payoutDue) {
        events.push({
          date: dateString(date), before, after: balance, delta: balance - before,
          interestAccrued: state.pendingHistoryInterest, interestPaidOut: paidOut, interestCapitalized: capitalized,
          eventType: capitalized ? "capitalized" : paidOut ? "paidOut" : "accrued",
          rate: annualRate,
        });
        state.pendingHistoryInterest = 0;
      }
      cursor = date;
    }
    state.lastProcessedDate = dateString(cursor);
    return { balance, state, events, config };
  }

  function migrateUserData(data, today) {
    const next = { ...(data || {}) };
    const configs = { ...(next.returnConfig || {}) };
    const states = { ...(next.returnEngineState || {}) };
    const quantities = next.qty || {};
    Object.keys(configs).forEach(function (id) {
      configs[id] = normalizeConfig(configs[id]);
      states[id] = createState(Number(quantities[id]) || 0, configs[id], today, states[id]);
    });
    next.returnConfig = configs;
    next.returnEngineState = states;
    next.engineVersion = 2;
    return next;
  }

  return { advance, normalizeConfig, migrateUserData, dailyRate, formulaInterest, parseDate, dateString, addDays, isBoundary, METHODS, FREQUENCIES };
});
