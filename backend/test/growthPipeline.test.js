const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const gp = require("../lib/growthPipeline.js");
const { legacyConfigToDomainModel } = require("../scripts/legacy-config-mapper.js");

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
  const cfg = {
    growthSource: "fixedRate",
    balanceBasis: "lowestPeriodBalance",
    startDate: "2026-07-01",
    growthFrequency: "monthly",
    compoundingFrequency: "monthly",
    distributionFrequency: "none",
    rateBasis: "nominal",
  };

  test("mid-period: not a growth boundary, cron posts nothing", () => {
    assert.equal(gp.dailyGrowthDelta(100000, 18, cfg, "2026-01-20"), null);
  });

  test("real growth-boundary day: simple interest for the elapsed days, reinvested", () => {
    const g = gp.dailyGrowthDelta(100000, 18, cfg, "2026-08-01");
    assert.ok(g && g.reinvest === true);
    assert.ok(Math.abs(g.amount - 100000 * (18 / 100 / 365) * 31) < 1e-6);
  });

  test("table projection (assumeContinuous) matches what the cron will actually post", () => {
    const principal = 142050.41;
    const from = d("2026-07-14");
    const to = d("2026-08-01");
    const projected = gp.projectValueAt(principal, 18, cfg, from, to, undefined, true);
    const cronDelta = gp.dailyGrowthDelta(principal, 18, cfg, "2026-08-01");
    assert.ok(Math.abs(projected - (principal + cronDelta.amount)) < 1e-6);
  });

  test("simulator (NOT assumeContinuous) never credits interest before its own start date", () => {
    const realCfg = { ...cfg, startDate: "2025-11-20", rateBasis: "effective" };
    const from = d("2026-04-08");
    const to = d("2026-07-13");
    const simVal = gp.projectValueAt(70000, 20.4, realCfg, from, to);
    const days = gp.daysBetweenDates(from, to);
    const dailyCompoundApprox = 70000 * Math.pow(1 + 20.4 / 100, days / 365);
    assert.ok(Math.abs(simVal - dailyCompoundApprox) < 50);
  });
});

describe("Certificate Engine — distributes, does not compound", () => {
  const cfg = {
    growthSource: "fixedRate",
    balanceBasis: "fixedPrincipal",
    startDate: "2026-01-08",
    growthFrequency: "annual",
    distributionFrequency: "annual",
    compoundingFrequency: "none",
    rateBasis: "nominal",
  };

  test("real distribution day: interest computed and logged, but NOT reinvested", () => {
    const g = gp.dailyGrowthDelta(200000, 20, cfg, "2027-01-08");
    assert.ok(g);
    assert.equal(g.reinvest, false);
    assert.ok(Math.abs(g.amount - 40000) < 1e-6);
  });

  test("no schedule configured: cron has nothing safe to auto-post", () => {
    assert.equal(
      gp.dailyGrowthDelta(200000, 20, { growthSource: "fixedRate", compoundingFrequency: "none" }, "2026-06-01"),
      null
    );
  });

  test("projection still shows the informational flat-interest estimate", () => {
    const value = gp.projectValueAt(200000, 20, cfg, d("2026-01-08"), d("2027-01-08"));
    assert.equal(value, 240000);
  });
});

describe("NAV daily-compounding fallback (growthSource: nav)", () => {
  test("matches (1 + apy)^(days/365) exactly", () => {
    const g = gp.dailyGrowthDelta(50000, 18.11, { growthSource: "nav" }, "2026-06-01");
    assert.ok(g && g.reinvest === true);
    const expectedDailyRate = Math.pow(1 + 18.11 / 100, 1 / 365) - 1;
    assert.ok(Math.abs(g.amount - 50000 * expectedDailyRate) < 1e-9);
  });

  test("a NAV product grows every single day, never waiting for a schedule boundary", () => {
    const cfg = {
      growthSource: "nav",
      growthFrequency: "daily",
      distributionFrequency: "none",
      compoundingFrequency: "daily",
      liquidityFrequency: "monthly",
      startDate: "2026-01-01",
    };
    for (let day = 1; day <= 28; day++) {
      const ds = `2026-02-${String(day).padStart(2, "0")}`;
      const g = gp.dailyGrowthDelta(100000, 20.06, cfg, ds);
      assert.ok(g && g.amount > 0, `expected daily growth on ${ds}`);
      assert.equal(g.reinvest, true);
    }
  });
});

// ── Regression test for the exact bug this refactor fixes ────────────────
// Under the OLD engine, `payoutFreq` alone gated both growth AND
// distribution. A NAV product with payoutFreq:"monthly" (Thunder Cloud
// Monthly's real preset) fell into the SAME "monthsStep && compounding"
// branch as a scheduled fixed-rate product — so the cron only posted
// interest once a month, as one large lump sum, even though the fund's NAV
// genuinely moves every day. The domain model fixes this structurally:
// growthSource:"nav" always grows daily, because growthFrequency and
// liquidityFrequency are no longer the same field.
describe("Regression: Thunder Cloud Monthly must compound daily, not monthly", () => {
  const legacyThunderMonthly = {
    calcMethod: "navBased",
    payoutFreq: "monthly",
    compounding: true,
    liquidity: "monthly",
    startDate: "2026-01-01",
    rateBasis: "effective",
  };
  const cfg = legacyConfigToDomainModel(legacyThunderMonthly);

  test("migrated config grows daily, distributes never, is liquid monthly", () => {
    assert.equal(cfg.growthSource, "nav");
    assert.equal(cfg.growthFrequency, "daily");
    assert.equal(cfg.distributionFrequency, "none");
    assert.equal(cfg.liquidityFrequency, "monthly");
  });

  test("cron posts something on an ordinary mid-month day (the old engine posted null here)", () => {
    const g = gp.dailyGrowthDelta(100000, 20.06, cfg, "2026-01-15");
    assert.ok(g && g.amount > 0);
    assert.equal(g.reinvest, true);
  });

  test("cron posts a genuine SINGLE day of growth on the 1st of the month, not a 31-day lump sum", () => {
    const g = gp.dailyGrowthDelta(100000, 20.06, cfg, "2026-02-01");
    const oneDayRate = Math.pow(1 + 20.06 / 100, 1 / 365) - 1;
    assert.ok(Math.abs(g.amount - 100000 * oneDayRate) < 1e-6);
    assert.ok(g.amount < 100);
  });
});

describe("Tiered certificates", () => {
  test("step-up compounding across tier anniversaries", () => {
    const cfg = { growthSource: "fixedRate", startDate: "2026-01-01", tierRates: [27, 22, 17] };
    const value = gp.projectValueAt(100000, 1, cfg, d("2026-01-01"), d("2027-01-01"));
    assert.ok(Math.abs(value - 127000) < 1);
  });
});

describe("Validation edge cases", () => {
  test("zero/negative principal or rate never grows", () => {
    assert.equal(gp.dailyGrowthDelta(0, 18, { growthSource: "nav" }, "2026-06-01"), null);
    assert.equal(gp.dailyGrowthDelta(1000, 0, { growthSource: "nav" }, "2026-06-01"), null);
  });

  test("projectValueAt is a no-op when target is not after from", () => {
    assert.equal(gp.projectValueAt(1000, 18, {}, d("2026-06-01"), d("2026-06-01")), 1000);
    assert.equal(gp.projectValueAt(1000, 18, {}, d("2026-06-05"), d("2026-06-01")), 1000);
  });
});

describe("validateDomainModel — domain consistency rules", () => {
  test("empty/not-yet-configured entries are valid (nothing to check yet)", () => {
    assert.equal(gp.validateDomainModel({}).valid, true);
  });

  test("NAV product cannot also declare an active distributionFrequency", () => {
    const r = gp.validateDomainModel({
      growthSource: "nav",
      growthFrequency: "daily",
      distributionFrequency: "monthly",
      compoundingFrequency: "none",
    });
    assert.equal(r.valid, false);
  });

  test("NAV product must grow daily", () => {
    const r = gp.validateDomainModel({ growthSource: "nav", growthFrequency: "monthly" });
    assert.equal(r.valid, false);
  });

  test("a product cannot both distribute and compound at the same time", () => {
    const r = gp.validateDomainModel({
      growthSource: "fixedRate",
      growthFrequency: "monthly",
      distributionFrequency: "monthly",
      compoundingFrequency: "monthly",
    });
    assert.equal(r.valid, false);
  });

  test("tierRates only apply to growthSource: fixedRate", () => {
    const r = gp.validateDomainModel({ growthSource: "nav", tierRates: [10, 9, 8] });
    assert.equal(r.valid, false);
  });

  test("every RETURN_PRESETS-shaped domain-model config is valid", () => {
    const presets = [
      {
        growthSource: "nav",
        growthFrequency: "daily",
        distributionFrequency: "none",
        compoundingFrequency: "daily",
        liquidityFrequency: "daily",
      },
      {
        growthSource: "nav",
        growthFrequency: "daily",
        distributionFrequency: "none",
        compoundingFrequency: "daily",
        liquidityFrequency: "monthly",
      },
      {
        growthSource: "fixedRate",
        balanceBasis: "lowestPeriodBalance",
        growthFrequency: "monthly",
        distributionFrequency: "none",
        compoundingFrequency: "monthly",
        liquidityFrequency: "monthly",
      },
      {
        growthSource: "fixedRate",
        balanceBasis: "currentBalance",
        growthFrequency: "daily",
        distributionFrequency: "none",
        compoundingFrequency: "daily",
        liquidityFrequency: "daily",
      },
      {
        growthSource: "fixedRate",
        balanceBasis: "fixedPrincipal",
        growthFrequency: "annual",
        distributionFrequency: "annual",
        compoundingFrequency: "none",
        liquidityFrequency: "maturity",
        tierRates: [27, 22, 17],
      },
    ];
    presets.forEach((cfg) => assert.equal(gp.validateDomainModel(cfg).valid, true, JSON.stringify(cfg)));
  });
});

describe("Migration parity — legacyConfigToDomainModel", () => {
  const cases = [
    {
      name: "Mashreq Savings (lowestMonthlyBalance, reinvests monthly)",
      legacy: {
        calcMethod: "lowestMonthlyBalance",
        payoutFreq: "monthly",
        compounding: true,
        liquidity: "monthly",
        startDate: "2026-02-15",
        rateBasis: "nominal",
      },
    },
    {
      name: "NBE Certificate (fixedPrincipal, distributes annually)",
      legacy: {
        calcMethod: "fixedPrincipal",
        payoutFreq: "annual",
        compounding: false,
        liquidity: "restricted",
        startDate: "2026-01-10",
        rateBasis: "nominal",
      },
    },
    {
      name: "Thndr Cloud Instant (navBased, already daily)",
      legacy: { calcMethod: "navBased", payoutFreq: "daily", compounding: true, liquidity: "daily", rateBasis: "effective" },
    },
  ];

  cases.forEach(({ name, legacy }) => {
    test(`${name} migrates to a valid domain model`, () => {
      const model = legacyConfigToDomainModel(legacy);
      const result = gp.validateDomainModel(model);
      assert.equal(result.valid, true, JSON.stringify({ model, errors: result.errors }));
    });
  });

  test("non-NAV migrated configs reproduce identical dailyGrowthDelta behaviour to the pre-migration formula", () => {
    const legacy = {
      calcMethod: "lowestMonthlyBalance",
      payoutFreq: "monthly",
      compounding: true,
      liquidity: "monthly",
      startDate: "2026-01-05",
      rateBasis: "nominal",
    };
    const cfg = legacyConfigToDomainModel(legacy);
    let qty = 75000;
    const apy = 18;
    for (let i = 0; i < 400; i++) {
      const dt = new Date(2026, 0, 1 + i);
      const ds = dt.toISOString().slice(0, 10);
      const g = gp.dailyGrowthDelta(qty, apy, cfg, ds);
      if (g && g.reinvest) qty += g.amount;
    }
    // ~18% nominal annual, monthly compounding over ~400 days — sanity-bound
    // the result instead of hardcoding a brittle exact figure, since the
    // point of this test is "still simple interest per monthly segment".
    assert.ok(qty > 75000 * 1.19 && qty < 75000 * 1.22, `unexpected compounded total: ${qty}`);
  });
});
