process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/kanz_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");

const dataRouter = require("../routes/data");
const authRouter = require("../routes/auth");
const cronRouter = require("../routes/cron");

test("isFiniteNumberMap: accepts a plain object of finite numbers", () => {
  assert.equal(dataRouter.isFiniteNumberMap({ usd: 100, gold: 12.5, egp: 0 }), true);
});

test("isFiniteNumberMap: rejects non-numeric, NaN, or Infinity values", () => {
  assert.equal(dataRouter.isFiniteNumberMap({ usd: "100" }), false);
  assert.equal(dataRouter.isFiniteNumberMap({ usd: NaN }), false);
  assert.equal(dataRouter.isFiniteNumberMap({ usd: Infinity }), false);
});

test("isFiniteNumberMap: rejects arrays, null, and prototype-pollution keys", () => {
  assert.equal(dataRouter.isFiniteNumberMap([1, 2, 3]), false);
  assert.equal(dataRouter.isFiniteNumberMap(null), false);
  const malicious = JSON.parse('{"__proto__": {"polluted": true}}');
  assert.equal(dataRouter.isFiniteNumberMap(malicious), false);
});

test("cleanUsername: lowercases and strips anything but a-z0-9_", () => {
  assert.equal(authRouter.cleanUsername("  Ahmed_123!! "), "ahmed_123");
  assert.equal(authRouter.cleanUsername("<script>"), "script");
  assert.equal(authRouter.cleanUsername(""), "");
  assert.equal(authRouter.cleanUsername(undefined), "");
});

test("isCairoTargetHour: matches only when Africa/Cairo's local hour is the target hour", () => {
  const cairoHourNow = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }).format(new Date()),
    10
  );
  assert.equal(cronRouter.isCairoTargetHour(), cairoHourNow === 3);
});
