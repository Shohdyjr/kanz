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

test("cleanEmail: trims and lowercases", () => {
  assert.equal(authRouter.cleanEmail("  Ahmed@Example.COM "), "ahmed@example.com");
  assert.equal(authRouter.cleanEmail(undefined), "");
});

test("EMAIL_RE: accepts plausible emails, rejects malformed ones", () => {
  assert.equal(authRouter.EMAIL_RE.test("ahmed@example.com"), true);
  assert.equal(authRouter.EMAIL_RE.test("ahmed@sub.example.com"), true);
  assert.equal(authRouter.EMAIL_RE.test("not-an-email"), false);
  assert.equal(authRouter.EMAIL_RE.test("missing@tld"), false);
  assert.equal(authRouter.EMAIL_RE.test("@example.com"), false);
  assert.equal(authRouter.EMAIL_RE.test("spaces in@example.com"), false);
});

test("isCairoTargetHour: matches only when Africa/Cairo's local hour is the target hour", () => {
  const cairoHourNow = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", hour: "2-digit", hour12: false }).format(new Date()),
    10
  );
  assert.equal(cronRouter.isCairoTargetHour(), cairoHourNow === 3);
});

test("isValidDateStr: accepts strict YYYY-MM-DD strings only", () => {
  assert.equal(dataRouter.isValidDateStr("2026-07-09"), true);
  assert.equal(dataRouter.isValidDateStr("2026-7-9"), false);
  assert.equal(dataRouter.isValidDateStr("09-07-2026"), false);
  assert.equal(dataRouter.isValidDateStr(""), false);
  assert.equal(dataRouter.isValidDateStr(undefined), false);
});

test("isValidReturnConfigMap: accepts a map of valid per-asset return-category entries", () => {
  assert.equal(
    dataRouter.isValidReturnConfigMap({
      thndr_cloud: { productType: "fixedIncomeFund", calcMethod: "navBased", payoutFreq: "daily", compounding: true },
      mashreq_savings: { productType: "savings", calcMethod: "dailyBalance", payoutFreq: "monthly" },
    }),
    true
  );
  assert.equal(dataRouter.isValidReturnConfigMap({}), true);
});

test("isValidReturnConfigMap: rejects unknown enum values, unknown keys, and wrong types", () => {
  assert.equal(dataRouter.isValidReturnConfigMap({ x: { productType: "not-a-real-type" } }), false);
  assert.equal(dataRouter.isValidReturnConfigMap({ x: { calcMethod: "dailyBalance", extra: "nope" } }), false);
  assert.equal(dataRouter.isValidReturnConfigMap({ x: { compounding: "true" } }), false);
  assert.equal(dataRouter.isValidReturnConfigMap([1, 2, 3]), false);
  assert.equal(dataRouter.isValidReturnConfigMap(null), false);
});
