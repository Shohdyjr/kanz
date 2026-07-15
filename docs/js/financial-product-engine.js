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
  // the documented numeric variables (principal, rate, days). This is a
  // small recursive-descent parser over a fixed token set (numbers, the
  // three variable names, +-*/^(), unary minus) — no property access, no
  // function calls, no strings, no globals, and critically no `Function`/
  // `eval` construction, so a saved formula can never execute arbitrary
  // code. Mirrors the safe parser already used by growthPipeline.js.
  function tokenizeFormula(src) {
    const tokens = [];
    const re = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|([+\-*/^()]))/g;
    let pos = 0;
    while (pos < src.length) {
      re.lastIndex = pos;
      const m = re.exec(src);
      if (!m || m.index !== pos) throw new Error(`Unexpected character at position ${pos}`);
      pos = re.lastIndex;
      if (m[1]) tokens.push({ type: "ident", value: m[1] });
      else if (m[2]) tokens.push({ type: "number", value: parseFloat(m[2]) });
      else if (m[3]) tokens.push({ type: "op", value: m[3] });
    }
    return tokens;
  }
  function parseFormulaAst(tokens) {
    let i = 0;
    const peek = () => tokens[i];
    const expect = (value) => {
      const tok = tokens[i];
      if (!tok || tok.value !== value) throw new Error(`Expected '${value}'`);
      i++;
      return tok;
    };
    function parseExpr() {
      let node = parseTerm();
      while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
        const op = tokens[i++].value;
        node = { type: "bin", op, left: node, right: parseTerm() };
      }
      return node;
    }
    function parseTerm() {
      let node = parseUnary();
      while (peek() && peek().type === "op" && (peek().value === "*" || peek().value === "/")) {
        const op = tokens[i++].value;
        node = { type: "bin", op, left: node, right: parseUnary() };
      }
      return node;
    }
    function parseUnary() {
      if (peek() && peek().type === "op" && peek().value === "-") {
        i++;
        return { type: "neg", value: parseUnary() };
      }
      return parsePower();
    }
    function parsePower() {
      const node = parseAtom();
      if (peek() && peek().type === "op" && peek().value === "^") {
        i++;
        return { type: "bin", op: "^", left: node, right: parseUnary() };
      }
      return node;
    }
    function parseAtom() {
      const tok = peek();
      if (!tok) throw new Error("Unexpected end of formula");
      if (tok.type === "number") { i++; return { type: "num", value: tok.value }; }
      if (tok.type === "ident") { i++; return { type: "var", name: tok.value }; }
      if (tok.type === "op" && tok.value === "(") {
        i++;
        const node = parseExpr();
        expect(")");
        return node;
      }
      throw new Error(`Unexpected token '${tok.value}'`);
    }
    const ast = parseExpr();
    if (i !== tokens.length) throw new Error("Unexpected trailing input");
    return ast;
  }
  function evalFormulaAst(node, vars) {
    switch (node.type) {
      case "num": return node.value;
      case "neg": return -evalFormulaAst(node.value, vars);
      case "var":
        if (!(node.name in vars)) throw new Error(`Unknown variable '${node.name}'`);
        return vars[node.name];
      case "bin": {
        const l = evalFormulaAst(node.left, vars);
        const r = evalFormulaAst(node.right, vars);
        if (node.op === "+") return l + r;
        if (node.op === "-") return l - r;
        if (node.op === "*") return l * r;
        if (node.op === "/") return l / r;
        if (node.op === "^") return Math.pow(l, r);
        throw new Error(`Unknown operator '${node.op}'`);
      }
      default: throw new Error(`Unknown node type '${node.type}'`);
    }
  }
  function formulaInterest(formula, principal, rate, days) {
    if (!formula || !String(formula).trim()) return null;
    try {
      const ast = parseFormulaAst(tokenizeFormula(String(formula)));
      const value = evalFormulaAst(ast, { principal, rate, days });
      return typeof value === "number" && Number.isFinite(value) ? value : null;
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
    // `n` is always applied to the ORIGINAL anchor via addMonths(anchor, n*step),
    // never chained cursor-to-cursor. addMonths() clamps an overflowing day
    // (e.g. day 31 stepping into a 28/29/30-day month) to that month's last
    // day — chaining from an already-clamped cursor would permanently
    // degrade a day-31 anchor to day-28 forever after the first February it
    // crosses, instead of resetting to 31 once months are long enough again.
    let n = 0;
    let cursor = anchor;
    while (cursor < date) {
      n++;
      cursor = addMonths(anchor, n * step);
    }
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
