import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isEmail, sha256, randomToken } from "../server/lib/crypto.js";
import { sendMail, sendVerificationEmail, sendPasswordResetEmail } from "../server/lib/mail.js";

describe("Email Service & Tokens", () => {
  test("isEmail correctly validates addresses", () => {
    assert.equal(isEmail("client@restaurant.fr"), true);
    assert.equal(isEmail("admin.test+promo@savora.com"), true);
    assert.equal(isEmail("invalid-email"), false);
    assert.equal(isEmail("@domain.com"), false);
    assert.equal(isEmail("user@.com"), false);
    assert.equal(isEmail(""), false);
  });

  test("randomToken generates cryptographically random URL-safe tokens", () => {
    const token1 = randomToken(32);
    const token2 = randomToken(32);
    assert.ok(token1.length >= 32);
    assert.notEqual(token1, token2);
    // Base64url should not have +, /, =
    assert.match(token1, /^[A-Za-z0-9_-]+$/);
  });

  test("sha256 produces deterministic, secure hex digests for token storage", () => {
    const token = "secure_reset_token_123456789";
    const hash1 = sha256(token);
    const hash2 = sha256(token);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.match(hash1, /^[0-9a-f]{64}$/);
    assert.notEqual(sha256("different_token"), hash1);
  });

  test("sendMail handles missing RESEND_API_KEY gracefully in dev mode", async () => {
    const res = await sendMail({
      to: "test@example.com",
      subject: "Test Savora",
      html: "<p>Bienvenue</p>",
      text: "Bienvenue",
    });

    // In dev environment without real RESEND_API_KEY, should safely return result without crashing
    assert.equal(typeof res.sent, "boolean");
    assert.ok(res.provider === "resend" || res.provider === "smtp" || res.provider === "dev");
  });

  test("sendVerificationEmail safely executes and returns status", async () => {
    const token = randomToken(32);
    const link = `http://localhost:5173/?verifyToken=${token}`;
    const res = await sendVerificationEmail("newcustomer@example.com", link, "123456");
    assert.equal(typeof res.sent, "boolean");
    assert.ok(res.provider !== undefined);
  });

  test("sendPasswordResetEmail safely executes and returns status", async () => {
    const token = randomToken(32);
    const link = `http://localhost:5173/?resetToken=${token}`;
    const res = await sendPasswordResetEmail("user@example.com", link);
    assert.equal(typeof res.sent, "boolean");
    assert.ok(res.provider !== undefined);
  });
});
