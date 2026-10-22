import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { restoreVercelUrl } from "../server/lib/vercel-path.js";

describe("Réécriture Vercel (/api/*)", () => {
  test("restaure un chemin à plusieurs segments", () => {
    assert.equal(
      restoreVercelUrl("/api?__savora_path=payments/status"),
      "/api/payments/status",
    );
  });

  test("restaure un chemin à un seul segment", () => {
    assert.equal(restoreVercelUrl("/api?__savora_path=menu"), "/api/menu");
  });

  test("conserve la query string d'origine", () => {
    assert.equal(
      restoreVercelUrl("/api?__savora_path=admin/orders&status=pending"),
      "/api/admin/orders?status=pending",
    );
  });

  test("ne touche pas une URL sans le paramètre", () => {
    assert.equal(restoreVercelUrl("/api/menu"), "/api/menu");
    assert.equal(restoreVercelUrl("/api/menu?x=1"), "/api/menu?x=1");
  });

  test("ignore les slashes initiaux du paramètre", () => {
    assert.equal(
      restoreVercelUrl("/api?__savora_path=%2Fhealth"),
      "/api/health",
    );
  });
});
