const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../docs/js/financial-product-engine");

test("effective rates are converted to their mathematically correct daily rate", () => {
  const annual = 0.18;
  assert.equal(engine.dailyRate(18, "effective"), Math.pow(1 + annual, 1 / 365) - 1);
  assert.equal(engine.dailyRate(18, "nominal"), annual / 365);
});

test("a non-compounding product records a payout without inflating its balance", () => {
  const result = engine.advance({
    balance: 100000, ratePercent: 36, fromDate: "2026-01-01", toDate: "2026-02-01",
    config: { calcMethod: "fixedPrincipal", rateBasis: "nominal", payoutFreq: "monthly", accrualFrequency: "monthly", compounding: false, startDate: "2026-01-01" },
  });
  assert.equal(result.balance, 100000);
  assert.equal(result.events.at(-1).eventType, "paidOut");
  assert.ok(result.events.at(-1).interestPaidOut > 0);
});

test("a fixed-principal tier schedule uses the matching annual tier", () => {
  const first = engine.advance({ balance: 1000, ratePercent: 0, fromDate: "2026-01-01", toDate: "2027-01-01", config: { calcMethod: "fixedPrincipal", rateBasis: "nominal", payoutFreq: "yearly", accrualFrequency: "yearly", compounding: true, startDate: "2026-01-01", tierRates: [36, 12] } });
  const second = engine.advance({ balance: first.balance, state: first.state, ratePercent: 0, fromDate: "2027-01-01", toDate: "2028-01-01", config: { calcMethod: "fixedPrincipal", rateBasis: "nominal", payoutFreq: "yearly", accrualFrequency: "yearly", compounding: true, startDate: "2026-01-01", tierRates: [36, 12] } });
  assert.ok(first.balance > 1300);
  assert.ok(second.balance > first.balance);
  assert.ok(second.balance < first.balance + 130);
});

test("legacy navBased configs migrate to effectiveCompound and gain engine state", () => {
  const data = engine.migrateUserData({ qty: { fund: 500 }, returnConfig: { fund: { calcMethod: "navBased", payoutFreq: "annual" } } }, "2026-07-13");
  assert.equal(data.returnConfig.fund.calcMethod, "effectiveCompound");
  assert.equal(data.returnConfig.fund.payoutFreq, "yearly");
  assert.equal(data.returnEngineState.fund.fixedPrincipal, 500);
});

test("lowest monthly balance uses the lowest balance observed in the cycle", () => {
  const config = { calcMethod: "lowestMonthlyBalance", rateBasis: "nominal", payoutFreq: "monthly", accrualFrequency: "monthly", compounding: true, startDate: "2026-01-01" };
  const state = { fixedPrincipal: 1000, periodMinimumBalance: 800, accruedInterest: 0, pendingHistoryInterest: 0, lastProcessedDate: "2026-01-31", periodStartDate: "2026-01-01" };
  const result = engine.advance({ balance: 1000, state, ratePercent: 36.5, fromDate: "2026-01-31", toDate: "2026-02-01", config });
  assert.equal(result.events.at(-1).interestCapitalized, 0.8);
  assert.equal(result.balance, 1000.8);
});
