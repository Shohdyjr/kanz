// These are pure-function tests only — no DB or network access — so they set
// dummy env vars up front purely to satisfy config/env.js's fail-fast checks.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/kanz_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultUserData, priceForServerSide, computeSnapshot } = require("../lib/rates");

const RATES = { egpPerUsd: 50, eurPerUsd: 0.9, sarPerUsd: 3.75, goldUsdPerGram: 80 };

test("priceForServerSide: USD is always 1", () => {
  assert.equal(priceForServerSide("USD", RATES), 1);
});

test("priceForServerSide: EGP/EUR/SAR are the inverse of the USD rate", () => {
  assert.equal(priceForServerSide("EGP", RATES), 1 / 50);
  assert.equal(priceForServerSide("EUR", RATES), 1 / 0.9);
  assert.equal(priceForServerSide("SAR", RATES), 1 / 3.75);
});

test("priceForServerSide: GOLD returns the per-gram price directly", () => {
  assert.equal(priceForServerSide("GOLD", RATES), 80);
});

test("priceForServerSide: unknown currency returns 0 instead of throwing", () => {
  assert.equal(priceForServerSide("BTC", RATES), 0);
});

test("computeSnapshot: a brand-new user's default data totals to zero", () => {
  const snapshot = computeSnapshot(defaultUserData(), RATES, "2026-07-08");
  assert.equal(snapshot.date, "2026-07-08");
  assert.equal(snapshot.totalUsd, 0);
  assert.equal(snapshot.egpUsd, 0);
  assert.equal(snapshot.hardUsd, 0);
  assert.equal(snapshot.goldUsd, 0);
  assert.equal(snapshot.assetsUsd, 0);
});

test("computeSnapshot: buckets EGP, hard currency, and gold base assets correctly", () => {
  const userData = {
    excludedBaseIds: ["thunder_invest", "tilda_invest", "ahli", "mashreq", "car"], // keep only thunder_save, usd, eur, sar, gold
    baseOverrides: {},
    customAssets: [],
    qty: { thunder_save: 5000, usd: 100, eur: 50, sar: 200, gold: 10 },
  };
  const snapshot = computeSnapshot(userData, RATES, "2026-07-08");

  assert.equal(snapshot.egpUsd, 5000 / 50); // thunder_save is EGP
  assert.equal(snapshot.hardUsd, 100 * 1 + 50 / 0.9 + 200 / 3.75); // usd + eur + sar
  assert.equal(snapshot.goldUsd, 10 * 80); // gold grams * usd/gram
  assert.equal(snapshot.assetsUsd, 0);
  assert.equal(snapshot.totalUsd, snapshot.egpUsd + snapshot.hardUsd + snapshot.goldUsd + snapshot.assetsUsd);
});

test("computeSnapshot: the 'car' base asset defaults to the assets bucket, not EGP", () => {
  const userData = {
    excludedBaseIds: ["thunder_save", "thunder_invest", "tilda_invest", "ahli", "mashreq", "usd", "eur", "sar", "gold"],
    baseOverrides: {},
    customAssets: [],
    qty: { car: 1000000 },
  };
  const snapshot = computeSnapshot(userData, RATES, "2026-07-08");
  assert.equal(snapshot.assetsUsd, 1000000 / 50);
  assert.equal(snapshot.egpUsd, 0);
});

test("computeSnapshot: baseOverrides.isAsset reclassifies a base asset's bucket", () => {
  const userData = {
    excludedBaseIds: ["thunder_invest", "tilda_invest", "ahli", "mashreq", "car", "usd", "eur", "sar", "gold"],
    baseOverrides: { thunder_save: { isAsset: true } }, // normally EGP, forced into assets here
    customAssets: [],
    qty: { thunder_save: 2000 },
  };
  const snapshot = computeSnapshot(userData, RATES, "2026-07-08");
  assert.equal(snapshot.egpUsd, 0);
  assert.equal(snapshot.assetsUsd, 2000 / 50);
});

test("computeSnapshot: custom assets are bucketed by their own currency/isAsset flag", () => {
  const userData = {
    excludedBaseIds: Object.keys(require("../lib/rates").BASE_ASSET_CURRENCY), // exclude all base assets
    baseOverrides: {},
    customAssets: [
      { id: "gold_jewelry", currency: "GOLD", isAsset: true },
      { id: "side_hustle_usd", currency: "USD", isAsset: false },
    ],
    qty: { gold_jewelry: 5, side_hustle_usd: 300 },
  };
  const snapshot = computeSnapshot(userData, RATES, "2026-07-08");
  // isAsset:true wins over currency-based bucketing, even for GOLD
  assert.equal(snapshot.assetsUsd, 5 * 80);
  assert.equal(snapshot.goldUsd, 0);
  assert.equal(snapshot.hardUsd, 300);
});

test("computeSnapshot: missing/non-numeric qty values are treated as zero, not NaN", () => {
  const userData = {
    excludedBaseIds: Object.keys(require("../lib/rates").BASE_ASSET_CURRENCY),
    baseOverrides: {},
    customAssets: [{ id: "weird", currency: "USD", isAsset: false }],
    qty: { weird: "not-a-number" },
  };
  const snapshot = computeSnapshot(userData, RATES, "2026-07-08");
  assert.equal(snapshot.hardUsd, 0);
  assert.ok(Number.isFinite(snapshot.totalUsd));
});
