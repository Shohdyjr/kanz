process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/kanz_test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "unit-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateOtp, hashOtp } = require("../lib/otp");

test("generateOtp: always a 6-digit zero-padded string", () => {
  for (let i = 0; i < 200; i++) {
    const otp = generateOtp();
    assert.equal(typeof otp, "string");
    assert.equal(otp.length, 6);
    assert.match(otp, /^\d{6}$/);
  }
});

test("hashOtp: deterministic, and different codes hash differently", () => {
  assert.equal(hashOtp("123456"), hashOtp("123456"));
  assert.notEqual(hashOtp("123456"), hashOtp("654321"));
  // sha256 hex digest is always 64 chars
  assert.equal(hashOtp("000000").length, 64);
});

test("hashOtp: never returns the plaintext code", () => {
  const otp = "042917";
  assert.notEqual(hashOtp(otp), otp);
});
