import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkHealth } from "../server/lib/health.js";
import { errorResponse } from "../server/lib/http.js";

describe("Health & erreurs de configuration", () => {
  test("DATABASE_URL absente -> not_configured", async () => {
    const h = await checkHealth({ databaseUrl: "", ping: async () => {} });
    assert.deepEqual(h, { status: "degraded", db: "not_configured" });
  });
  test("base joignable -> ok", async () => {
    const h = await checkHealth({ databaseUrl: "postgres://x", ping: async () => {} });
    assert.deepEqual(h, { status: "ok", db: "ok" });
  });
  test("base en erreur -> error, sans détail interne", async () => {
    const h = await checkHealth({ databaseUrl: "postgres://x", ping: async () => { throw new Error("password=secret"); } });
    assert.deepEqual(h, { status: "degraded", db: "error" });
    assert.ok(!JSON.stringify(h).includes("secret"));
  });
  test("DATABASE_URL manquante -> 503 unavailable (régression)", async () => {
    const res = errorResponse(new Error("DATABASE_URL is not configured"));
    assert.equal(res.status, 503);
    assert.equal((await res.json() as { code: string }).code, "unavailable");
  });
  test("erreur SQL/connexion -> 500 internal, pas 503", async () => {
    const res = errorResponse(new Error("connect ETIMEDOUT"));
    assert.equal(res.status, 500);
  });
});
