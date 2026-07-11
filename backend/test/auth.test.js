process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/kanz_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";
process.env.REMEMBER_TOKEN_DAYS = process.env.REMEMBER_TOKEN_DAYS || "7";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, comparePassword, issueToken, verifyTokenValue, safeEqual } = require("../lib/auth");

test("hashPassword/comparePassword: round-trips correctly", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await comparePassword("correct horse battery staple", hash), true);
  assert.equal(await comparePassword("wrong password", hash), false);
});

test("issueToken/verifyTokenValue: round-trips the username", () => {
  const { token, expiresAt } = issueToken("ahmed123");
  assert.equal(verifyTokenValue(token), "ahmed123");
  assert.ok(expiresAt > Date.now());
});

test("verifyTokenValue: rejects a garbage token instead of throwing", () => {
  assert.equal(verifyTokenValue("not-a-real-jwt"), null);
  assert.equal(verifyTokenValue(""), null);
});

test("safeEqual: true only for identical strings, false for mismatched/wrong-type input", () => {
  assert.equal(safeEqual("secret123", "secret123"), true);
  assert.equal(safeEqual("secret123", "secret124"), false);
  assert.equal(safeEqual("short", "muchlonger"), false);
  assert.equal(safeEqual(undefined, "secret123"), false);
  assert.equal(safeEqual(null, null), false);
});
