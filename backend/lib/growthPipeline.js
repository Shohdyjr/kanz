// ══════════════════════════════════════════════════════════════════════════
//  growthPipeline.js — SINGLE SOURCE OF TRUTH for every interest/return
//  calculation in Kanz. This is the ONLY financial engine in the project —
//  docs/js/financial-product-engine.js (an earlier, never-wired-up
//  prototype) has been deleted; do not recreate a second engine.
//
//  This exact file is used by:
//    - the backend (required by growthEngine.js / the nightly cron)
//    - the frontend (loaded as a plain <script> tag — see docs/js/growth-pipeline.js,
//      which MUST be an exact copy of this file; run `npm run sync-pipeline`
//      after editing this file, before committing/pushing)
//
//  ── The domain model ─────────────────────────────────────────────────────
//  `returnConfig[itemId]` is stored directly in this shape. Every field maps
//  to exactly one financial concept — there is no overloaded field standing
//  in for two or three different meanings anymore (that was the old
//  calcMethod/payoutFreq/compounding design; see MIGRATION.md for the
//  history and backend/scripts/migrate-to-domain-model.js for the one-time
//  conversion that retired it):
//
//    - growthSource:          WHY the value changes.
//                             fixedRate | nav | manual
//    - growthFrequency:       HOW OFTEN the value itself updates.
//                             daily | monthly | quarterly | semiAnnual | annual | maturity
//    - distributionFrequency: WHEN profit is actually paid out in cash.
//                             none | daily | monthly | quarterly | annual | maturity
//    - compoundingFrequency:  WHEN growth is reinvested into the balance.
//                             none | daily | monthly | quarterly | semiAnnual | annual | maturity
//    - liquidityFrequency:    WHEN funds become redeemable.
//                             daily | weekly | monthly | quarterly | maturity
//    - balanceBasis:          WHICH principal growth is computed against
//                             (only meaningful for growthSource:"fixedRate").
//                             currentBalance | fixedPrincipal
//    - rateBasis:             whether the stored `apy` % is a Nominal APR or
//                             an Effective APY/EAR. nominal | effective
//    - startDate:             the anchor date period boundaries count from.
//    - growthFormula:         optional user-written override for the
//                             per-segment interest formula.
//    - tierRates:             step-up certificate: a different rate each
//                             year, starting from startDate.
//
//  A product is internally consistent when compoundingFrequency and
//  distributionFrequency are never both "active" at once (growth is either
//  retained or paid out, never both) — see validateDomainModel below, which
//  every returnConfig write is checked against (backend/routes/data.js).
// ══════════════════════════════════════════════════════════════════════════

// ── Growth Model registry ───────────────────────────────────────────────
// Each growthSource is a self-contained strategy that owns whether Credit
// concepts (Compounding/Distribution/Accrual) apply to it at all — this is
// what makes NAV and Discount "not using Compounding" a validation FACT
// about that model, not a special case bolted onto validateDomainModel.
// Adding a new valuation strategy (e.g. a future marketPrice model for
// stocks/ETFs priced by trades rather than a fund's own NAV) means adding
// one entry here plus a branch in projectValueAt/dailyGrowthDelta — never a
// scattered growthSource === "..." check somewhere else in the engine.
//   usesCredit         — Compounding/Distribution/Accrual concepts apply
//   requiresRate        — needs a apy/rate % to mean anything
//   requiresDailyGrowth — must use growthFrequency: "daily" (continuous)
const GROWTH_MODELS = {
  fixedRate: { usesCredit: true, requiresRate: true, requiresDailyGrowth: false },
  nav: { usesCredit: false, requiresRate: true, requiresDailyGrowth: true },
  // Treasury Bills, zero-coupon bonds: value is purely the gap between
  // purchasePrice and faceValue, realized continuously toward maturityDate.
  // No rate, no periods, no credit events — see discountValueAt below.
  discount: { usesCredit: false, requiresRate: false, requiresDailyGrowth: false },
  manual: { usesCredit: true, requiresRate: true, requiresDailyGrowth: false },
};

// Domain rules. Explains exactly *why* a config is invalid — no silent
// coercion. Called from backend/routes/data.js on every write; the engine
// itself assumes it only ever receives configs that already passed this.
function validateDomainModel(cfg) {
  const c = cfg || {};
  const errors = [];
  if (!c.growthSource) return { valid: true, errors }; // not configured yet — nothing to validate
  const model = GROWTH_MODELS[c.growthSource];
  if (!model) {
    errors.push(`Unknown growthSource: '${c.growthSource}'.`);
    return { valid: false, errors };
  }
  const distributing = c.distributionFrequency && c.distributionFrequency !== "none";
  const compounding = c.compoundingFrequency && c.compoundingFrequency !== "none";

  if (!model.usesCredit && (distributing || compounding)) {
    errors.push(
      `growthSource: '${c.growthSource}' doesn't use Compounding or Distribution — its value already reflects the full return on its own (a NAV price, or a discount-to-face accrual), so leave those two fields unset.`
    );
  }
  if (model.requiresDailyGrowth && c.growthFrequency !== "daily") {
    errors.push(`growthSource: '${c.growthSource}' grows continuously and must use growthFrequency: 'daily'.`);
  }
  if (distributing && compounding) {
    errors.push("A product cannot both distribute cash and compound automatically at the same time — growth is either paid out or reinvested, not both.");
  }
  if (Array.isArray(c.tierRates) && c.tierRates.length && c.growthSource !== "fixedRate") {
    errors.push("Tiered step-up rates (tierRates) only apply to growthSource: 'fixedRate' certificates.");
  }
  if (model.usesCredit && !distributing && !compounding && c.growthSource !== "manual" && !Array.isArray(c.tierRates)) {
    errors.push("A product must either distribute or compound its growth somehow (distributionFrequency or compoundingFrequency must be active), or declare growthSource: 'manual' with a custom formula.");
  }
  if (c.growthSource === "discount") {
    if (!(c.faceValue > 0)) errors.push("growthSource: 'discount' requires a faceValue (the amount paid out at maturity).");
    if (!c.maturityDate) errors.push("growthSource: 'discount' requires a maturityDate.");
    if (c.maturityDate && c.startDate && parseDateStr(c.maturityDate) <= parseDateStr(c.startDate)) {
      errors.push("growthSource: 'discount' requires maturityDate to be after startDate (the issue date).");
    }
  }
  if (c.creditAnchor === "fixedDay" && !(c.creditDay >= 1 && c.creditDay <= 31)) {
    errors.push("creditAnchor: 'fixedDay' requires a creditDay between 1 and 31.");
  }
  if (c.balanceBasis === "tieredByBalance") {
    if (!Array.isArray(c.balanceTiers) || !c.balanceTiers.length) {
      errors.push("balanceBasis: 'tieredByBalance' requires at least one balance tier (balanceTiers).");
    } else {
      c.balanceTiers.forEach((t, i) => {
        if (!(t.rate >= 0)) errors.push(`Balance tier #${i + 1} needs a rate.`);
        if (!(t.min >= 0)) errors.push(`Balance tier #${i + 1} needs a minimum balance (min).`);
        if (t.max != null && t.max <= t.min) errors.push(`Balance tier #${i + 1}'s max must be greater than its min.`);
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetweenDates(d1, d2) {
  return Math.round((d2 - d1) / 86400000);
}

function addYearsToDate(d, n) {
  return addMonthsClamped(d, n * 12);
}

// Steps `d` forward (or backward, for negative `months`) by whole calendar
// months, clamping the day-of-month to the last real day of the destination
// month instead of letting it overflow.
//
// `new Date(y, m + step, day)` — the naive version this replaces — does NOT
// clamp: JS Date silently rolls extra days into the FOLLOWING month, e.g.
// `new Date(2026, 0, 31)` stepped "+1 month" the naive way is
// `new Date(2026, 1, 31)`, which JS normalizes to **March 3, 2026** (Feb
// 2026 only has 28 days). For an item anchored on the 29th/30th/31st, every
// boundary/anniversary calculation built on that primitive (payout-boundary
// detection, "next payout" projection, tiered-certificate anniversaries)
// would silently skip the February cycle entirely and permanently shift
// the anchor date forward by however many days it overflowed by. This
// clamps instead, matching real-world "same day next month, or the last day
// of the month if it doesn't have one" bank behaviour (Jan 31 → Feb 28/29 →
// Mar 31 → Apr 30 → ... — the day resets to 31 whenever the new month is
// long enough again, it does not stay pinned at the clamped value).
function addMonthsClamped(d, months) {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const firstOfTarget = new Date(y, m, 1);
  const daysInTarget = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  firstOfTarget.setDate(Math.min(d.getDate(), daysInTarget));
  return firstOfTarget;
}

function monthsStepForFreq(frequency) {
  if (frequency === "monthly") return 1;
  if (frequency === "quarterly") return 3;
  if (frequency === "semiAnnual") return 6;
  if (frequency === "annual" || frequency === "maturity") return 12;
  return null;
}

// Walks forward in `monthsStep` jumps from `startDateStr` (anchored to its
// day-of-month) until it exactly reaches `dateObj`. Returns the boundary
// just before `dateObj` if `dateObj` IS a boundary, or null if `dateObj`
// falls mid-period (i.e. nothing should be posted for that day). Used by the
// daily cron, which only ever needs to know "is today a payout day".
function periodBoundaryAt(startDateStr, monthsStep, dateObj) {
  if (!startDateStr || !monthsStep) return null;
  const anchor = parseDateStr(startDateStr);
  if (dateObj <= anchor) return null;
  // Step count `n` is always applied to the ORIGINAL anchor (addMonthsClamped(anchor, n*step)),
  // never chained cursor-to-cursor — otherwise a day-31 anchor that gets
  // clamped to 28 in February would permanently degrade to the 28th every
  // month after, instead of resetting to 31 once months are long enough
  // again (see addMonthsClamped's doc comment).
  let n = 0;
  let cursor = anchor;
  let prev = anchor;
  while (cursor < dateObj) {
    n++;
    prev = cursor;
    cursor = addMonthsClamped(anchor, n * monthsStep);
  }
  return cursor.getTime() === dateObj.getTime() ? prev : null;
}

// Like periodBoundaryAt, but for projecting from an arbitrary `at` date that
// may fall mid-period (the table/simulator project from "today", which is
// essentially never exactly a payout day) — returns the period boundary
// at-or-before `at`, walking backwards through anniversaries if the anchor
// date itself is still in the future relative to `at`.
function periodStartAtOrBefore(startDateStr, monthsStep, at) {
  const anchor = parseDateStr(startDateStr);
  if (anchor > at) {
    let n = 0;
    let cursor = anchor;
    while (cursor > at) {
      n--;
      cursor = addMonthsClamped(anchor, n * monthsStep);
    }
    return cursor;
  }
  let n = 0;
  let cursor = anchor;
  let prev = anchor;
  while (cursor <= at) {
    n++;
    prev = cursor;
    cursor = addMonthsClamped(anchor, n * monthsStep);
  }
  return prev;
}

// Next date that is startDateStr + N*monthsStep (integer N), strictly after
// `after`. Anchors "next payout" to the account's actual opening date.
function anniversaryAfter(startDateStr, monthsStep, after) {
  const anchor = parseDateStr(startDateStr);
  if (anchor > after) return anchor;
  let n = 0;
  let cursor = anchor;
  while (cursor <= after) {
    n++;
    cursor = addMonthsClamped(anchor, n * monthsStep);
  }
  return cursor;
}

// ── Credit Anchor ────────────────────────────────────────────────────────
// WHERE, within the Calculation cadence (growthFrequency's own monthsStep),
// a real Credit event actually falls — a separate question from HOW OFTEN
// (that's still growthFrequency). Generalizes the one shape the engine used
// to hardcode (an anniversary of the account's own startDate — correct for
// a certificate/CD whose term literally starts on deposit day) to the other
// shapes real institutions use:
//   "anniversary"       — startDate + N*monthsStep (default; unchanged
//                          behavior for every existing config, since this
//                          is what periodStartAtOrBefore/anniversaryAfter
//                          always did before creditAnchor existed)
//   "calendarPeriodEnd" — the calendar month/quarter/year-end containing
//                          the reference date, regardless of which day the
//                          account opened (e.g. Mashreq NEO Savings credits
//                          at calendar month-end, not "one month after you
//                          opened it")
//   "fixedDay"           — the same numbered day of the month every time
//                          (config.creditDay, clamped to the month's actual
//                          last day), stepped monthsStep months at a time
// `config.creditBusinessDayAdjust: true` rolls a boundary landing on a
// Saturday/Sunday forward to the following Monday. Weekend-only — Kanz has
// no holiday calendar, so a public holiday can still land a credit a day
// off; documented here rather than silently pretended away.
function endOfCalendarPeriod(d, monthsStep) {
  const periodEndMonth = Math.floor(d.getMonth() / monthsStep) * monthsStep + monthsStep - 1;
  return new Date(d.getFullYear(), periodEndMonth + 1, 0);
}

function fixedDayInMonth(year, month0, creditDay) {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(creditDay || 1, lastDay));
}

function rollToBusinessDay(d) {
  const day = d.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (day === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2);
  return d;
}

// Most recent Credit boundary at-or-before `at`.
function creditBoundaryAtOrBefore(cfg, monthsStep, at) {
  const config = cfg || {};
  const kind = config.creditAnchor || "anniversary";
  let boundary;
  if (kind === "calendarPeriodEnd") {
    boundary = endOfCalendarPeriod(at, monthsStep);
    if (boundary.getTime() > at.getTime()) {
      boundary = endOfCalendarPeriod(new Date(at.getFullYear(), at.getMonth() - monthsStep, 1), monthsStep);
    }
  } else if (kind === "fixedDay") {
    boundary = fixedDayInMonth(at.getFullYear(), at.getMonth(), config.creditDay);
    if (boundary.getTime() > at.getTime()) {
      const prevMonth = new Date(at.getFullYear(), at.getMonth() - monthsStep, 1);
      boundary = fixedDayInMonth(prevMonth.getFullYear(), prevMonth.getMonth(), config.creditDay);
    }
  } else {
    boundary = periodStartAtOrBefore(config.startDate, monthsStep, at);
  }
  return config.creditBusinessDayAdjust ? rollToBusinessDay(boundary) : boundary;
}

// Next Credit boundary strictly after `after`.
function nextCreditBoundary(cfg, monthsStep, after) {
  const config = cfg || {};
  const kind = config.creditAnchor || "anniversary";
  let boundary;
  if (kind === "calendarPeriodEnd") {
    boundary = endOfCalendarPeriod(after, monthsStep);
    if (boundary.getTime() <= after.getTime()) {
      boundary = endOfCalendarPeriod(new Date(after.getFullYear(), after.getMonth() + monthsStep, 1), monthsStep);
    }
  } else if (kind === "fixedDay") {
    boundary = fixedDayInMonth(after.getFullYear(), after.getMonth(), config.creditDay);
    if (boundary.getTime() <= after.getTime()) {
      const nextMonth = new Date(after.getFullYear(), after.getMonth() + monthsStep, 1);
      boundary = fixedDayInMonth(nextMonth.getFullYear(), nextMonth.getMonth(), config.creditDay);
    }
  } else {
    boundary = anniversaryAfter(config.startDate, monthsStep, after);
  }
  return config.creditBusinessDayAdjust ? rollToBusinessDay(boundary) : boundary;
}

// ── Safe expression evaluator for user-written growth formulas ─────────
// Previously this used `new Function(...)`, i.e. arbitrary JS code
// execution. Even in a single-user app, running text as code is an
// unnecessary risk (and blocks any future move to multi-user use) for what
// is really just an arithmetic expression over 3 known variables. This is a
// small recursive-descent parser: no code execution, only numbers,
// +-*/^(), unary minus, and a short whitelist of math functions.
const SAFE_FORMULA_FUNCTIONS = {
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

function tokenizeFormula(src) {
  const tokens = [];
  const re = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\d+(?:\.\d+)?)|([+\-*/^(),]))/g;
  let m;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m || m.index !== pos) throw new Error(`Unexpected character at position ${pos}`);
    pos = re.lastIndex;
    if (m[1]) tokens.push({ type: "ident", value: m[1] });
    else if (m[2]) tokens.push({ type: "number", value: parseFloat(m[2]) });
    else if (m[3]) tokens.push({ type: "op", value: m[3] });
  }
  return tokens;
}

// Grammar (standard precedence climbing):
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | power
//   power  := atom ('^' unary)?         (right-associative)
//   atom   := number | ident | ident '(' args ')' | '(' expr ')'
function parseFormulaAst(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const expect = (value) => {
    const t = tokens[i];
    if (!t || t.value !== value) throw new Error(`Expected '${value}'`);
    i++;
    return t;
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
    const t = peek();
    if (!t) throw new Error("Unexpected end of formula");
    if (t.type === "number") {
      i++;
      return { type: "num", value: t.value };
    }
    if (t.type === "ident") {
      i++;
      if (peek() && peek().value === "(") {
        i++;
        const args = [];
        if (peek() && peek().value !== ")") {
          args.push(parseExpr());
          while (peek() && peek().value === ",") {
            i++;
            args.push(parseExpr());
          }
        }
        expect(")");
        return { type: "call", name: t.value, args };
      }
      return { type: "var", name: t.value };
    }
    if (t.type === "op" && t.value === "(") {
      i++;
      const node = parseExpr();
      expect(")");
      return node;
    }
    throw new Error(`Unexpected token '${t.value}'`);
  }

  const ast = parseExpr();
  if (i !== tokens.length) throw new Error("Unexpected trailing input");
  return ast;
}

function evalFormulaAst(node, vars) {
  switch (node.type) {
    case "num":
      return node.value;
    case "neg":
      return -evalFormulaAst(node.value, vars);
    case "var":
      if (!(node.name in vars)) throw new Error(`Unknown variable '${node.name}'`);
      return vars[node.name];
    case "call": {
      const fn = SAFE_FORMULA_FUNCTIONS[node.name];
      if (!fn) throw new Error(`Unknown function '${node.name}'`);
      return fn(...node.args.map((a) => evalFormulaAst(a, vars)));
    }
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
    default:
      throw new Error(`Unknown node type '${node.type}'`);
  }
}

// Evaluates a user-written formula (returnConfig[id].growthFormula) against
// {principal, rate, days}, returning the interest amount, or null if the
// formula is empty/invalid — callers fall back to the built-in default.
// Safe expression parser only — no code execution (see above).
function evalGrowthFormula(formula, principal, rate, days) {
  if (!formula || !String(formula).trim()) return null;
  try {
    const ast = parseFormulaAst(tokenizeFormula(String(formula)));
    const result = evalFormulaAst(ast, { principal, rate, days });
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
  growthFrequency,
  fromDate,
  targetDate,
  cfg,
  assumeContinuous
) {
  const monthsStep = monthsStepForFreq(growthFrequency);
  if (!startDateStr || !monthsStep || !ratePercent || targetDate <= fromDate) return principal;

  let balance = principal;
  const periodStart = periodStartAtOrBefore(startDateStr, monthsStep, fromDate);
  // periodStart is always at-or-before fromDate by construction — so this
  // is a no-op (cursor = fromDate) when assumeContinuous is false.
  let cursor = assumeContinuous ? periodStart : fromDate;
  // Each boundary is computed via anniversaryAfter(startDateStr, ...), which
  // always steps from the TRUE anchor date, not from the previous boundary —
  // chaining `new Date(cursor.year, cursor.month + step, cursor.date)`
  // cursor-to-cursor would permanently degrade a day-29/30/31 anchor to
  // whatever it got clamped to the first time it crossed a February.
  let nextBoundary = anniversaryAfter(startDateStr, monthsStep, periodStart);

  while (nextBoundary <= targetDate) {
    const days = daysBetweenDates(cursor, nextBoundary);
    balance += segmentInterest(cfg, balance, ratePercent, days);
    cursor = nextBoundary;
    nextBoundary = anniversaryAfter(startDateStr, monthsStep, nextBoundary);
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

// ── Discount growth model (Treasury Bills, zero-coupon bonds) ───────────
// Value grows linearly (straight-line, actual/actual) from purchasePrice at
// issue (config.startDate) to faceValue at config.maturityDate — no rate,
// no periods, no credit events: the "return" is entirely the gap between
// what you paid and what you'll get back, realized continuously as time
// passes. This is what lets Treasury Bills and zero-coupon bonds be
// represented without a dedicated product type — they're just this one
// growth model plus a face value and a maturity date.
function discountValueAt(config, targetDate) {
  if (!config.startDate || !config.maturityDate) return config.purchasePrice || 0;
  const issue = parseDateStr(config.startDate);
  const maturity = parseDateStr(config.maturityDate);
  const purchasePrice = config.purchasePrice || 0;
  const faceValue = config.faceValue || 0;
  if (maturity <= issue) return purchasePrice;
  if (targetDate >= maturity) return faceValue;
  if (targetDate <= issue) return purchasePrice;
  const totalDays = daysBetweenDates(issue, maturity);
  const elapsedDays = daysBetweenDates(issue, targetDate);
  return purchasePrice + (faceValue - purchasePrice) * (elapsedDays / totalDays);
}

// ── The one projection entry point, used by BOTH the table's projection
// columns and the simulator (via an explicit rateBasis override) ──────────
// `basisOverride`, when given, replaces cfg.rateBasis (the simulator's
// APY/APR toggle re-runs this exact math under the other interpretation
// without touching the item's saved config).
// ── Balance-tiered rate (e.g. Mashreq NEO Savings: 11%/12%/16% depending on
// which EGP balance band the account is currently in) ───────────────────
// Confirmed behavior: it's a BAND rate, not a marginal/graduated one — the
// WHOLE balance earns whichever single tier's rate it currently falls
// into (same convention Egyptian banks publish these in), not "first X at
// rate A, the rest at rate B" like a tax bracket. A tier with no `max` (or
// `max: null`) is open-ended — it keeps applying to any balance above its
// `min`, however high, matching Egyptian banks' behavior of the top band
// continuing to apply above the balance they published examples up to
// (rather than interest simply stopping).
//
// Resolved once per projectValueAt call against the CURRENT balance
// (`principal`) — not re-evaluated mid-period as the balance compounds —
// same lightweight-approximation tradeoff the rest of this engine makes
// elsewhere (e.g. tierRates' anniversary-only re-evaluation).
// ── AUDIT FIX (2026-07-24) ──────────────────────────────────────────────
// Resolves which frequency actually governs a periodic-boundary/compounding
// schedule. `growthFrequency` answers "how granular is the accrual
// calculation" (often "daily") — it is NOT "how often does the balance
// actually compound/credit". That's compoundingFrequency (or
// distributionFrequency for a non-reinvested payout). Mirrors
// cycleFrequency() in docs/js/return-config.js, which already gets the
// "Next credit" DATE right by preferring compoundingFrequency — this brings
// the VALUE calculation below into agreement with it.
//
// ROOT CAUSE this fixes: monthsStepForFreq() only recognizes
// monthly/quarterly/semiAnnual/annual/maturity — "daily" (used by every
// preset's growthFrequency) returns null. Every call below used to do
// monthsStepForFreq(config.growthFrequency) directly, which is therefore
// ALWAYS null for every "calculate daily, credit monthly" product — silently
// skipping periodicBoundaryValueAt (the correct calendar-boundary compounding
// engine) and falling through to an unrelated continuous-daily-compounding
// fallback that (a) anchors to `fromDate` ("today" from the table) instead
// of the real Since-date, and (b) compounds a Nominal APR continuously
// instead of crediting it monthly. Confirmed against real projections during
// a mathematical audit — see docs-dev/growth-engine-audit-2026-07-24.md.
function compoundingFrequencyFor(config) {
  if (config.compoundingFrequency && config.compoundingFrequency !== "none") return config.compoundingFrequency;
  if (config.distributionFrequency && config.distributionFrequency !== "none") return config.distributionFrequency;
  return config.growthFrequency;
}

function resolveTieredRate(config, balance, fallbackRate) {
  if (config.balanceBasis !== "tieredByBalance" || !Array.isArray(config.balanceTiers) || !config.balanceTiers.length) {
    return fallbackRate;
  }
  const tier = config.balanceTiers.find(
    (t) => balance >= (t.min || 0) && (t.max == null || balance <= t.max)
  );
  return tier ? tier.rate : fallbackRate;
}

function projectValueAt(principal, rate, cfg, fromDate, targetDate, basisOverride, assumeContinuous) {
  const config = cfg || {};
  if (config.growthSource === "discount") return discountValueAt(config, targetDate);
  if (!principal || targetDate <= fromDate) return principal;
  rate = resolveTieredRate(config, principal, rate);

  if (config.startDate && Array.isArray(config.tierRates) && config.tierRates.length) {
    const tierAnchor = assumeContinuous ? config.startDate : formatDateStr(fromDate);
    return tieredValueAt(principal, tierAnchor, config.tierRates, targetDate);
  }
  if (!rate) return principal;

  const basis = basisOverride || config.rateBasis;
  const compounds = config.compoundingFrequency && config.compoundingFrequency !== "none";
  const monthsStep = monthsStepForFreq(compoundingFrequencyFor(config));

  if (config.growthSource !== "nav" && config.startDate && monthsStep && compounds) {
    // periodicBoundaryValueAt's internal math is simple/nominal-style
    // (rate/365 × days). If the stored number is actually an Effective
    // APY/EAR, convert it down to this product's own compounding frequency
    // first, so the per-period simple interest still adds up to the
    // effective annual yield the user actually has.
    const periodsPerYear = 12 / monthsStep;
    const nominalRate = basis === "effective" ? effectiveToNominal(rate, periodsPerYear) : rate;
    // Which date anchors the monthly/quarterly/... boundary days:
    //   - assumeContinuous (table): the item's REAL Since-date — boundaries
    //     must land on the account's actual real-world payout days.
    //   - otherwise (simulator): the hypothetical `fromDate` the user typed
    //     — a self-contained "what if" shouldn't inherit boundary days from
    //     an unrelated real account, even one previously configured on this
    //     same item.
    const anchorDate = assumeContinuous ? config.startDate : formatDateStr(fromDate);
    return periodicBoundaryValueAt(
      principal,
      anchorDate,
      nominalRate,
      compoundingFrequencyFor(config),
      fromDate,
      targetDate,
      config,
      !!assumeContinuous
    );
  }

  // Flat cases below are never auto-grown by the daily cron (a product with
  // no active compoundingFrequency isn't reinvested, and a custom formula
  // outside a period structure isn't posted automatically either) — so for
  // the table (assumeContinuous), `principal` here is NOT already "as of
  // today"; anchor to the item's real Since-date if set. The simulator
  // instead always anchors to its own chosen `fromDate` — same
  // self-containment rule as the periodic-boundary branch above.
  const flatBasisDate = assumeContinuous && config.startDate ? parseDateStr(config.startDate) : fromDate;

  if (config.growthSource === "manual" && config.growthFormula) {
    const days = Math.max(0, daysBetweenDates(flatBasisDate, targetDate));
    return principal + segmentInterest(config, principal, rate, days);
  }

  // Flat, no active compounding: simple interest off the original
  // principal (balanceBasis:"fixedPrincipal") or the fallback "not
  // reinvested" case (compoundingFrequency:"none" with no schedule).
  if (config.growthSource !== "nav" && (config.balanceBasis === "fixedPrincipal" || !compounds)) {
    return simpleFlatValueAt(principal, rate, flatBasisDate, targetDate, config);
  }

  // Fallback: continuous daily compounding — growthSource:"nav" (the daily
  // cron already grows this item's qty every day, so `principal` here IS
  // already "as of today" — always accrue from `fromDate`, never
  // `startDate`), or a fixedRate product with no schedule that still
  // compounds daily.
  const effectiveRate = basis === "nominal" ? nominalToEffective(rate, 365) : rate;
  const days = Math.max(0, daysBetweenDates(fromDate, targetDate));
  return principal * Math.pow(1 + effectiveRate / 100, days / 365);
}

// ── Backend cron entry point ────────────────────────────────────────────
// Returns the interest to post for `todayStr`, or null if nothing should be
// posted today. Return shape:
//   { amount, reinvest: true }   → add `amount` to qty AND log it
//   { amount, reinvest: false }  → do NOT touch qty, but still log `amount`
//                                  as interest earned today (distributed
//                                  elsewhere — e.g. a certificate's coupon)
//   null                         → not a payout day / nothing configured
//
// The interest is always computed and logged on the real growth boundary;
// only whether it folds back into `qty` depends on compoundingFrequency.
function dailyGrowthDelta(qty, apyPercent, cfg, todayStr) {
  const config = cfg || {};
  const today = parseDateStr(todayStr);

  if (config.growthSource === "discount") {
    if (!qty) return null;
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const before = discountValueAt(config, yesterday);
    const after = discountValueAt(config, today);
    return after !== before ? { amount: after - before, reinvest: true } : null;
  }

  const rate = resolveTieredRate(config, qty, apyPercent || 0);
  if (!rate || !qty) return null;
  const reinvest = !!(config.compoundingFrequency && config.compoundingFrequency !== "none");

  // Tiered certificates aren't auto-posted day to day by the cron
  // (anniversaries are wide apart, best reviewed by hand rather than
  // silently posted).
  if (config.startDate && Array.isArray(config.tierRates) && config.tierRates.length) return null;

  const monthsStep = monthsStepForFreq(compoundingFrequencyFor(config));
  if (config.growthSource !== "nav" && config.startDate && monthsStep) {
    const boundaryToday = creditBoundaryAtOrBefore(config, monthsStep, today);
    if (boundaryToday.getTime() !== today.getTime()) return null; // not a Credit day — balance stays flat
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const periodStart = creditBoundaryAtOrBefore(config, monthsStep, yesterday);
    const days = daysBetweenDates(periodStart, today);
    const periodsPerYear = 12 / monthsStep;
    const nominalRate = config.rateBasis === "effective" ? effectiveToNominal(rate, periodsPerYear) : rate;
    const amount = segmentInterest(config, qty, nominalRate, days);
    return { amount, reinvest };
  }

  if (config.growthSource === "manual" && config.growthFormula) {
    // No period structure configured, but a custom formula exists — the
    // cron runs once a day, so this posts one day's worth of interest.
    return { amount: segmentInterest(config, qty, rate, 1), reinvest };
  }

  if (config.growthSource !== "nav" && !reinvest) {
    // No period structure to anchor a real growth boundary to — nothing
    // safe to auto-post daily. The item's own projection (projectValueAt
    // above) still shows the informational "if left running" estimate in
    // the UI; this just means the stored balance/history isn't
    // auto-updated for it.
    return null;
  }

  // Fallback: continuous daily compounding — growthSource:"nav" (money
  // market / fixed-income funds whose NAV moves every day), or a
  // fixedRate/daily product with no schedule that still compounds daily.
  const effectiveRate = config.rateBasis === "nominal" ? nominalToEffective(rate, 365) : rate;
  const dailyRate = Math.pow(1 + effectiveRate / 100, 1 / 365) - 1;
  return { amount: qty * dailyRate, reinvest: true };
}

// Tells the person, in plain terms, the next date the daily cron will
// actually touch (post growth to) this item's stored balance. Mirrors
// dailyGrowthDelta()'s branching exactly — every "does it apply today?"
// check there has a matching "when next?" answer here — so the two can
// never silently drift apart.
//   reasonKey is one of:
//     "cronTouchNoBalance" — no balance or no rate set; nothing to post
//     "cronTouchDaily"     — touches every day (most common: growthSource
//                             nav, growthFrequency daily, or a manual formula)
//     "cronTouchPeriodic"  — touches only on its own periodic boundary
//                             (growthFrequency has a real monthsStep)
//     "cronTouchManual"    — never auto-touched; needs manual review
//                             (tiered certificates, or a non-reinvesting
//                             product with no period structure to anchor to)
function nextCronTouch(qty, apyPercent, cfg, todayStr) {
  const config = cfg || {};
  const today = parseDateStr(todayStr);

  if (config.growthSource === "discount") {
    if (!qty) return { date: null, reasonKey: "cronTouchNoBalance" };
    const maturity = config.maturityDate ? parseDateStr(config.maturityDate) : null;
    if (maturity && today >= maturity) return { date: null, reasonKey: "cronTouchManual" };
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    return { date: tomorrow, reasonKey: "cronTouchDaily" };
  }

  const rate = resolveTieredRate(config, qty, apyPercent || 0);
  if (!rate || !qty) return { date: null, reasonKey: "cronTouchNoBalance" };
  const reinvest = !!(config.compoundingFrequency && config.compoundingFrequency !== "none");
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  if (config.startDate && Array.isArray(config.tierRates) && config.tierRates.length) {
    return { date: null, reasonKey: "cronTouchManual" };
  }

  const monthsStep = monthsStepForFreq(compoundingFrequencyFor(config));
  if (config.growthSource !== "nav" && config.startDate && monthsStep) {
    return { date: nextCreditBoundary(config, monthsStep, today), reasonKey: "cronTouchPeriodic" };
  }

  if (config.growthSource === "manual" && config.growthFormula) {
    return { date: tomorrow, reasonKey: "cronTouchDaily" };
  }

  if (config.growthSource !== "nav" && !reinvest) {
    return { date: null, reasonKey: "cronTouchManual" };
  }

  return { date: tomorrow, reasonKey: "cronTouchDaily" };
}

// ── Phase 1 of the domain redesign (see docs-dev/architecture-principles.md
// "Financial Product Redesign" section) — separating Credit from
// Compounding/Distribution as its own concept, and Accrued Earnings as a
// value distinct from the stored balance. Both are pure, computed-only
// additions: nothing about what's stored (qty, item_history) changes here.

// The cadence at which accrued earnings actually become real (credited) —
// compounding if the product reinvests, else distribution if it pays out
// cash, else null (credited continuously — a daily-growth product's stored
// balance already reflects fully-credited value every day, since the cron's
// daily fallback folds growth straight into qty; see dailyGrowthDelta).
// validateDomainModel() guarantees compounding and distribution are never
// both active, so this is never ambiguous.
function creditFrequency(cfg) {
  const config = cfg || {};
  const model = GROWTH_MODELS[config.growthSource];
  if (!model || !model.usesCredit) return null;
  if (config.compoundingFrequency && config.compoundingFrequency !== "none") return config.compoundingFrequency;
  if (config.distributionFrequency && config.distributionFrequency !== "none") return config.distributionFrequency;
  return null;
}

// Splits a product's current stored balance into what's already credited
// (the balance itself — real, already reinvested or already paid out) vs.
// earned-but-not-yet-credited (accruing at the product's rate, but won't
// become a real event until the next Credit boundary). For a continuously
// credited product this is always zero — nothing is ever "pending" because
// the cron folds growth in every single day. For a periodic product (e.g. a
// certificate crediting quarterly), this fills a real gap: today, nothing
// shows the person "how much have you earned since the last credit event
// that hasn't posted yet". This is always an ESTIMATE — projected from the
// balance as of the last credit boundary, assuming no deposit/withdrawal
// happened since (one would skew it slightly) — never a stored value.
function accrualBreakdown(qty, apyPercent, cfg, todayStr) {
  const config = cfg || {};
  const model = GROWTH_MODELS[config.growthSource];
  const rate = resolveTieredRate(config, qty, apyPercent || 0);
  // Models without Credit (nav, discount) never have anything "pending" —
  // their value already reflects everything, continuously, on its own.
  if (!model || !model.usesCredit || !rate || !qty) {
    return { creditedBalance: qty || 0, accruedEarnings: 0, lastCreditDate: null, nextCreditDate: null };
  }

  // Gates on growthFrequency, not creditFrequency(cfg) — that's a different
  // axis (whether earned interest reinvests or pays out cash once it's
  // real). Whether the cron touches qty continuously (daily) or only on a
  // periodic boundary is decided by growthFrequency alone, exactly mirroring
  // dailyGrowthDelta's own branching — a daily-growth, monthly-compounding
  // product (e.g. Mashreq-style savings) is folded into qty every single
  // day, so it's continuously credited regardless of compoundingFrequency's
  // label; nothing is ever "pending" for it.
  const monthsStep = monthsStepForFreq(compoundingFrequencyFor(config));
  if (!config.startDate || !monthsStep) {
    return { creditedBalance: qty, accruedEarnings: 0, lastCreditDate: null, nextCreditDate: null };
  }

  const today = parseDateStr(todayStr);
  const lastCreditDate = creditBoundaryAtOrBefore(config, monthsStep, today);
  const accruedEstimate = projectValueAt(qty, rate, config, lastCreditDate, today) - qty;
  const nextCreditDate = nextCreditBoundary(config, monthsStep, today);

  return { creditedBalance: qty, accruedEarnings: Math.max(0, accruedEstimate), lastCreditDate, nextCreditDate };
}

const GrowthPipeline = {
  parseDateStr,
  daysBetweenDates,
  addYearsToDate,
  monthsStepForFreq,
  periodBoundaryAt,
  periodStartAtOrBefore,
  anniversaryAfter,
  creditBoundaryAtOrBefore,
  nextCreditBoundary,
  evalGrowthFormula,
  segmentInterest,
  nominalToEffective,
  effectiveToNominal,
  periodicBoundaryValueAt,
  simpleFlatValueAt,
  tieredValueAt,
  discountValueAt,
  projectValueAt,
  dailyGrowthDelta,
  nextCronTouch,
  creditFrequency,
  accrualBreakdown,
  validateDomainModel,
  GROWTH_MODELS,
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
