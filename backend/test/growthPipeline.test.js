const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const gp = require("../lib/growthPipeline.js");

const d = (s) => gp.parseDateStr(s);

describe("day counting", () => {
  test("simple span", () => {
    assert.equal(gp.daysBetweenDates(d("2026-01-01"), d("2026-01-31")), 30);
  });

  test("leap year — Feb has 29 days in 2028", () => {
    assert.equal(gp.daysBetweenDates(d("2028-02-01"), d("2028-03-01")), 29);
  });

  test("non-leap year — Feb has 28 days in 2026", () => {
    assert.equal(gp.daysBetweenDates(d("2026-02-01"), d("2026-03-01")), 28);
  });

  test("deterministic across the real 2026 Egypt DST spring-forward (Apr 24)", () => {
    // Only meaningful when run under TZ=Africa/Cairo (see package.json test script).
    assert.equal(gp.daysBetweenDates(d("2026-04-08"), d("2026-07-13")), 96);
  });

  test("deterministic across the real 2026 Egypt DST fall-back (Oct 30)", () => {
    assert.equal(gp.daysBetweenDates(d("2026-10-25"), d("2026-11-05")), 11);
  });
});

describe("APR/APY conversion", () => {
  test("nominal == effective at annual compounding (m=1)", () => {
    assert.equal(gp.nominalToEffective(18, 1), 18);
    assert.equal(gp.effectiveToNominal(18, 1), 18);
  });

  test("nominal -> effective increases with compounding frequency", () => {
    const monthly = gp.nominalToEffective(18, 12);
    const daily = gp.nominalToEffective(18, 365);
    assert.ok(monthly > 18);
    assert.ok(daily > monthly);
  });

  test("round-trips back to the original rate", () => {
    const eff = gp.nominalToEffective(20.4, 12);
    const nom = gp.effectiveToNominal(eff, 12);
    assert.ok(Math.abs(nom - 20.4) < 1e-9);
  });
});

describe("safe formula evaluator (no code execution)", () => {
  test("evaluates the documented default-equivalent formula", () => {
    const result = gp.evalGrowthFormula("principal * (rate/100/365) * days", 100000, 18, 31);
    assert.ok(Math.abs(result - 1528.7671232876712) < 1e-6);
  });

  test("supports parentheses, unary minus, and power", () => {
    assert.equal(gp.evalGrowthFormula("2 ^ 3", 0, 0, 0), 8);
    assert.equal(gp.evalGrowthFormula("-(2 + 3)", 0, 0, 0), -5);
  });

  test("supports the whitelisted math functions", () => {
    assert.equal(gp.evalGrowthFormula("pow(2, 10)", 0, 0, 0), 1024);
    assert.equal(gp.evalGrowthFormula("max(1, 2, 3)", 0, 0, 0), 3);
  });

  test("cannot execute arbitrary JS — this must fail closed, not run code", () => {
    // No `eval`/`Function`/global access exists in the grammar at all; an
    // attempt to reference anything other than principal/rate/days or a
    // whitelisted function simply fails to parse.
    assert.equal(gp.evalGrowthFormula("process.exit(1)", 0, 0, 0), null);
    assert.equal(gp.evalGrowthFormula("this.constructor", 0, 0, 0), null);
    assert.equal(gp.evalGrowthFormula("require('fs')", 0, 0, 0), null);
  });

  test("invalid syntax returns null (caller falls back to default)", () => {
    assert.equal(gp.evalGrowthFormula("principal * * days", 100, 10, 30), null);
    assert.equal(gp.evalGrowthFormula("", 100, 10, 30), null);
  });
});

describe("Bank Engine — periodic-boundary (e.g. Mashreq monthly savings)", () => {
  const cfg = { startDate: "2026-07-01", payoutFreq: "monthly", compounding: true, rateBasis: "nominal" };

  test("mid-period: not a payout day, cron posts nothing", () => {
    assert.equal(gp.dailyGrowthDelta(100000, 18, cfg, "2026-01-20"), null);
  });

  test("real payout day: simple interest for the elapsed days, reinvested", () => {
    const g = gp.dailyGrowthDelta(100000, 18, cfg, "2026-08-01");
    assert.ok(g && g.reinvest === true);
    assert.ok(Math.abs(g.amount - 100000 * (18 / 100 / 365) * 31) < 1e-6);
  });

  test("table projection (assumeContinuous) matches what the cron will actually post", () => {
    const principal = 142050.41;
    const from = d("2026-07-14"); // "today", mid-period
    const to = d("2026-08-01"); // the real payout day
    const projected = gp.projectValueAt(principal, 18, cfg, from, to, undefined, true);
    const cronDelta = gp.dailyGrowthDelta(principal, 18, cfg, "2026-08-01");
    assert.ok(Math.abs(projected - (principal + cronDelta.amount)) < 1e-6);
  });

  test("simulator (NOT assumeContinuous) never credits interest before its own start date", () => {
    // Real Since-date is a completely different month; the simulator must
    // still only count days from its own chosen start date forward.
    const realCfg = { startDate: "2025-11-20", payoutFreq: "monthly", compounding: true, rateBasis: "effective" };
    const from = d("2026-04-08");
    const to = d("2026-07-13");
    const simVal = gp.projectValueAt(70000, 20.4, realCfg, from, to); // assumeContinuous omitted -> false
    const days = gp.daysBetweenDates(from, to);
    const dailyCompoundApprox = 70000 * Math.pow(1 + 20.4 / 100, days / 365);
    // Should track a genuine ~96-day accrual, not include any days before `from`.
    assert.ok(Math.abs(simVal - dailyCompoundApprox) < 50);
  });
});

describe("Certificate Engine — compounding: false", () => {
  const cfg = {
    startDate: "2026-01-08",
    payoutFreq: "annual",
    compounding: false,
    rateBasis: "nominal",
    calcMethod: "fixedPrincipal",
  };

  test("real payout day: interest computed and logged, but NOT reinvested", () => {
    const g = gp.dailyGrowthDelta(200000, 20, cfg, "2027-01-08");
    assert.ok(g);
    assert.equal(g.reinvest, false);
    assert.ok(Math.abs(g.amount - 40000) < 1e-6);
  });

  test("no schedule configured: cron has nothing safe to auto-post", () => {
    assert.equal(
      gp.dailyGrowthDelta(200000, 20, { compounding: false, calcMethod: "fixedPrincipal" }, "2026-06-01"),
      null
    );
  });

  test("projection still shows the informational flat-interest estimate", () => {
    const value = gp.projectValueAt(200000, 20, cfg, d("2026-01-08"), d("2027-01-08"));
    assert.equal(value, 240000);
  });
});

describe("Thndr / daily-compounding fallback (calcMethod: navBased / dailyBalance)", () => {
  test("matches (1 + apy)^(days/365) exactly", () => {
    const g = gp.dailyGrowthDelta(50000, 18.11, {}, "2026-06-01");
    assert.ok(g && g.reinvest === true);
    const expectedDailyRate = Math.pow(1 + 18.11 / 100, 1 / 365) - 1;
    assert.ok(Math.abs(g.amount - 50000 * expectedDailyRate) < 1e-9);
  });
});

describe("Tiered certificates", () => {
  test("step-up compounding across tier anniversaries", () => {
    const cfg = { startDate: "2026-01-01", tierRates: [27, 22, 17] };
    const value = gp.projectValueAt(100000, 1 /* unused for tiered */, cfg, d("2026-01-01"), d("2027-01-01"));
    assert.ok(Math.abs(value - 127000) < 1);
  });
});

describe("Validation edge cases", () => {
  test("zero/negative principal or rate never grows", () => {
    assert.equal(gp.dailyGrowthDelta(0, 18, {}, "2026-06-01"), null);
    assert.equal(gp.dailyGrowthDelta(1000, 0, {}, "2026-06-01"), null);
  });

  test("projectValueAt is a no-op when target is not after from", () => {
    assert.equal(gp.projectValueAt(1000, 18, {}, d("2026-06-01"), d("2026-06-01")), 1000);
    assert.equal(gp.projectValueAt(1000, 18, {}, d("2026-06-05"), d("2026-06-01")), 1000);
  });
});

describe("Product model (growth / distribution / liquidity / compounding)", () => {
  test("Thunder Cloud Monthly: daily NAV growth, no distribution, monthly liquidity", () => {
    const cfg = { calcMethod: "navBased", payoutFreq: "monthly", compounding: true, liquidity: "monthly", startDate: "2026-01-01" };
    const model = gp.deriveProductModel(cfg);
    assert.equal(model.growthSource, "nav");
    assert.equal(model.growthFrequency, "daily");
    assert.equal(model.distributionFrequency, "none");
    assert.equal(model.liquidityFrequency, "monthly");
    assert.equal(model.compoundingFrequency, "daily");
  });

  test("fixed-rate certificate: yearly growth/distribution, not compounding", () => {
    const cfg = { calcMethod: "fixedPrincipal", payoutFreq: "annual", compounding: false, startDate: "2026-01-01" };
    const model = gp.deriveProductModel(cfg);
    assert.equal(model.growthSource, "fixedRate");
    assert.equal(model.growthFrequency, "annual");
    assert.equal(model.distributionFrequency, "annual");
    assert.equal(model.compoundingFrequency, "none");
  });

  test("monthly savings: grows, reinvests and is liquid monthly, never distributes", () => {
    const cfg = { calcMethod: "lowestMonthlyBalance", payoutFreq: "monthly", compounding: true, liquidity: "monthly" };
    const model = gp.deriveProductModel(cfg);
    assert.equal(model.growthFrequency, "monthly");
    assert.equal(model.distributionFrequency, "none");
    assert.equal(model.compoundingFrequency, "monthly");
  });

  test("validateProductModel is silent for every RETURN_PRESETS-shaped config", () => {
    const presets = [
      { calcMethod: "navBased", payoutFreq: "daily", compounding: true, liquidity: "daily" },
      { calcMethod: "navBased", payoutFreq: "monthly", compounding: true, liquidity: "monthly" },
      { calcMethod: "lowestMonthlyBalance", payoutFreq: "monthly", compounding: true, liquidity: "monthly" },
      { calcMethod: "dailyBalance", payoutFreq: "daily", compounding: true, liquidity: "daily" },
      { calcMethod: "fixedPrincipal", payoutFreq: "maturity", compounding: false, liquidity: "restricted" },
    ];
    presets.forEach((cfg) => assert.equal(gp.validateProductModel(cfg).valid, true, JSON.stringify(cfg)));
  });
});
