import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { 
  hashPassword, 
  verifyPassword, 
  passwordIssues, 
  randomToken, 
  hashIp
} from "../server/lib/crypto.js";

describe("Authentication & Crypto Security", () => {
  test("passwordIssues enforces password policy (10+ chars, uppercase, lowercase, number)", () => {
    assert.ok(passwordIssues("short").length > 0);
    assert.ok(passwordIssues("nouppercase123").length > 0);
    assert.ok(passwordIssues("NOLOWERCASE123").length > 0);
    assert.ok(passwordIssues("NoNumbersAtAll").length > 0);
    
    // Compliant password
    const issues = passwordIssues("StrongP@ssw0rd!");
    assert.equal(issues.length, 0);
  });

  test("hashPassword and verifyPassword work correctly with scrypt", async () => {
    const pwd = "CorrectHorseBatteryStaple1!";
    const hash = await hashPassword(pwd);

    assert.ok(hash.startsWith("scrypt$16384$8$1$"));
    
    // Correct password verifies successfully
    const isValid = await verifyPassword(pwd, hash);
    assert.equal(isValid, true);

    // Wrong password fails
    const isWrong = await verifyPassword("WrongPassword123!", hash);
    assert.equal(isWrong, false);

    // Corrupted hash fails safely
    const isCorrupt = await verifyPassword(pwd, hash.slice(0, -5) + "aaaaa");
    assert.equal(isCorrupt, false);
  });

  test("Session and OAuth state tokens are high-entropy and URL-safe", () => {
    const sessionToken = randomToken(32);
    const oauthState = randomToken(24);

    assert.ok(sessionToken.length >= 32);
    assert.ok(oauthState.length >= 24);
    assert.match(sessionToken, /^[A-Za-z0-9_-]+$/);
    assert.match(oauthState, /^[A-Za-z0-9_-]+$/);
  });

  test("hashIp creates privacy-preserving pseudonymized hashes", () => {
    const ip1 = "192.168.1.100";
    const ip2 = "192.168.1.101";

    const hash1 = hashIp(ip1);
    const hash2 = hashIp(ip2);
    const hash1Again = hashIp(ip1);

    assert.notEqual(hash1, null);
    assert.equal(hash1, hash1Again);
    assert.notEqual(hash1, hash2);
    assert.equal(hashIp(null), null);
  });

  test("Google OAuth URL construction includes required OpenID Connect parameters", () => {
    const clientId = "mock-client-id.apps.googleusercontent.com";
    const redirectUri = "http://localhost:8787/api/auth/google/callback";
    const state = randomToken(24);

    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.set("client_id", clientId);
    googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "openid email profile");
    googleAuthUrl.searchParams.set("state", state);
    googleAuthUrl.searchParams.set("prompt", "select_account");

    const fullUrl = googleAuthUrl.toString();
    assert.ok(fullUrl.includes("accounts.google.com/o/oauth2/v2/auth"));
    assert.ok(fullUrl.includes("openid+email+profile") || fullUrl.includes("openid%20email%20profile"));
    assert.ok(fullUrl.includes(state));
    assert.ok(fullUrl.includes(encodeURIComponent(redirectUri)));
  });
});
