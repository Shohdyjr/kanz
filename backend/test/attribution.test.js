const test = require("node:test");
const assert = require("node:assert/strict");
const { computeAttribution } = require("../lib/attribution");

test("computeAttribution: splits external cash flow from a snapshot delta", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 30000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 1200, nativeTotals: { egp: 36000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  // Salary of 200 USD equivalent, no price movement (same rates both ends).
  const activities = [{ date: "2026-01-15", type: "salary", amountUsd: 200 }];
  const result = computeAttribution(history, activities, [], "2026-01-01", "2026-02-01");

  assert.equal(result.totalDelta, 200);
  assert.equal(result.externalCashFlow, 200);
  assert.equal(result.marketRevaluation, 0);
  assert.equal(result.fxGainLoss, 0);
  assert.equal(result.unattributed, 0);
});

test("computeAttribution: isolates gold market revaluation from FX", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 600, nativeTotals: { egp: 0, gold: 10, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 650, nativeTotals: { egp: 0, gold: 10, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 65 } },
  ];
  const result = computeAttribution(history, [], [], "2026-01-01", "2026-02-01");

  assert.equal(result.totalDelta, 50);
  assert.equal(result.marketRevaluation, 50); // 10g * (65-60)
  assert.equal(result.fxGainLoss, 0);
  assert.equal(result.unattributed, 0);
});

test("computeAttribution: isolates FX gain from an EGP bucket with no quantity change", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 30000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 1500, nativeTotals: { egp: 30000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 20, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  const result = computeAttribution(history, [], [], "2026-01-01", "2026-02-01");

  assert.equal(result.totalDelta, 500);
  assert.equal(result.marketRevaluation, 0);
  assert.ok(Math.abs(result.fxGainLoss - 500) < 1e-9);
  assert.ok(Math.abs(result.unattributed) < 1e-9);
});

test("computeAttribution: investment income comes from item_history, converted from its native currency", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 30000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 1010, nativeTotals: { egp: 30300, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  const itemHistory = [{ itemId: "mashreq", date: "2026-01-20", before: 30000, after: 30300, delta: 300, apy: 10 }];
  const itemCurrency = () => "EGP";
  const priceAt = (currency, rates) => (currency === "EGP" ? 1 / rates.egpPerUsd : 1);
  const result = computeAttribution(history, [], itemHistory, "2026-01-01", "2026-02-01", itemCurrency, priceAt);

  assert.equal(result.investmentIncome, 10); // 300 EGP / 30 = 10 USD
  assert.ok(Math.abs(result.unattributed) < 1e-9);
});

test("computeAttribution: without a currency lookup, item_history deltas are assumed already-USD (safe default)", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 0, gold: 0, usd: 1000, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 1010, nativeTotals: { egp: 0, gold: 0, usd: 1010, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  const itemHistory = [{ itemId: "usd_acct", date: "2026-01-20", before: 1000, after: 1010, delta: 10, apy: 10 }];
  const result = computeAttribution(history, [], itemHistory, "2026-01-01", "2026-02-01");

  assert.equal(result.investmentIncome, 10);
  assert.ok(Math.abs(result.unattributed) < 1e-9);
});

test("computeAttribution: legacy untyped Activities (income/expense by sign) still count", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 0, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 900, nativeTotals: { egp: 0, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  // No `type` field at all — the shape every pre-typed Activity has.
  const activities = [{ date: "2026-01-10", amountUsd: -100 }];
  const result = computeAttribution(history, activities, [], "2026-01-01", "2026-02-01");

  assert.equal(result.externalCashFlow, -100);
  assert.equal(result.unattributed, 0);
});

test("computeAttribution: buy/sell/transfer/correction land in otherBalanceChanges, never traced further", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000, nativeTotals: { egp: 0, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
    { date: "2026-02-01", totalUsd: 1000, nativeTotals: { egp: 0, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  const activities = [
    { date: "2026-01-05", type: "transfer", amountUsd: 300, fromItemId: "a", toItemId: "b" },
    { date: "2026-01-05", type: "transfer", amountUsd: -300, fromItemId: "a", toItemId: "b" },
    { date: "2026-01-10", type: "correction", amountUsd: 50 },
    { date: "2026-01-10", type: "correction", amountUsd: -50 },
  ];
  const result = computeAttribution(history, activities, [], "2026-01-01", "2026-02-01");

  assert.equal(result.otherBalanceChanges, 0); // nets out, as it should for same-total transfers/corrections
  assert.equal(result.externalCashFlow, 0);
  assert.equal(result.unattributed, 0);
});

test("computeAttribution: missing nativeTotals on an old snapshot reports unattributed honestly, not zero", () => {
  const history = [
    { date: "2026-01-01", totalUsd: 1000 }, // pre-dates this feature — no nativeTotals/ratesUsed
    { date: "2026-02-01", totalUsd: 1100, nativeTotals: { egp: 33000, gold: 0, usd: 0, eur: 0, sar: 0 }, ratesUsed: { egpPerUsd: 30, eurPerUsd: 1, sarPerUsd: 3.75, goldUsdPerGram: 60 } },
  ];
  const result = computeAttribution(history, [], [], "2026-01-01", "2026-02-01");

  assert.equal(result.marketRevaluation, null);
  assert.equal(result.fxGainLoss, null);
  assert.equal(result.note, "revaluationNotDerivable");
  assert.equal(result.unattributed, 100); // honestly unexplained, not misreported as 0 growth
});

test("computeAttribution: missing snapshot entirely reports null totalDelta, not a wrong number", () => {
  const history = [{ date: "2026-02-01", totalUsd: 1100 }];
  const result = computeAttribution(history, [], [], "2026-01-01", "2026-02-01");
  assert.equal(result.totalDelta, null);
  assert.equal(result.note, "missingSnapshots");
});
