import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  computeGeniusPaySignature,
  verifyGeniusPayWebhookSignature,
  mapGeniusPayEventToStatus,
  createGeniusPayPayment,
} from "../server/lib/geniuspay.js";

const TEST_SECRET = "whsec_test_geniuspay_secret_key_123456789";

describe("GeniusPay — Signature HMAC-SHA256 & Horodatage", () => {
  const samplePayload = JSON.stringify({
    event: "payment.success",
    data: {
      id: "gp_pay_987654321",
      reference: "SAV-TEST-001",
      amount: 7500,
      currency: "XOF",
      metadata: { order_id: "e4b476eb-0000-0000-0000-000000000000" },
    },
  });

  test("calcule correctement la signature HMAC-SHA256 selon la formule GeniusPay", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const expected = createHmac("sha256", TEST_SECRET)
      .update(`${timestamp}.${samplePayload}`)
      .digest("hex");

    const calculated = computeGeniusPaySignature(samplePayload, timestamp, TEST_SECRET);
    assert.equal(calculated, expected);
  });

  test("valide une signature exacte dans la fenêtre de tolérance de 5 minutes", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // Timestamp d'il y a 2 minutes
    const timestamp = nowSeconds - 120;
    const signature = computeGeniusPaySignature(samplePayload, timestamp, TEST_SECRET);

    const result = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature,
      timestamp,
      secret: TEST_SECRET,
    });

    assert.equal(result.valid, true);
  });

  test("supporte les timestamps exprimés en millisecondes", () => {
    // Timestamp en ms il y a 30 secondes
    const timestampMs = Date.now() - 30_000;
    const signature = computeGeniusPaySignature(samplePayload, timestampMs, TEST_SECRET);

    const result = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature,
      timestamp: timestampMs,
      secret: TEST_SECRET,
    });

    assert.equal(result.valid, true);
  });

  test("supporte le préfixe sha256= ou v1= dans l'en-tête de signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = computeGeniusPaySignature(samplePayload, timestamp, TEST_SECRET);

    const res1 = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature: `sha256=${signature}`,
      timestamp,
      secret: TEST_SECRET,
    });
    assert.equal(res1.valid, true);

    const res2 = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature: `v1=${signature}`,
      timestamp,
      secret: TEST_SECRET,
    });
    assert.equal(res2.valid, true);
  });

  test("rejette un webhook avec un timestamp plus vieux que 5 minutes (300 secondes)", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // 305 secondes dans le passé
    const timestamp = nowSeconds - 305;
    const signature = computeGeniusPaySignature(samplePayload, timestamp, TEST_SECRET);

    const result = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature,
      timestamp,
      secret: TEST_SECRET,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, "timestamp_expired");
  });

  test("rejette un webhook si le payload a été altéré (attaque de falsification)", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = computeGeniusPaySignature(samplePayload, timestamp, TEST_SECRET);

    // Payload modifié (ex: montant falsifié)
    const tamperedPayload = samplePayload.replace("7500", "100");

    const result = verifyGeniusPayWebhookSignature({
      rawBody: tamperedPayload,
      signature,
      timestamp,
      secret: TEST_SECRET,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, "signature_mismatch");
  });

  test("rejette une signature calculée avec un mauvais secret", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = computeGeniusPaySignature(samplePayload, timestamp, "mauvais_secret");

    const result = verifyGeniusPayWebhookSignature({
      rawBody: samplePayload,
      signature,
      timestamp,
      secret: TEST_SECRET,
    });

    assert.equal(result.valid, false);
    assert.equal(result.reason, "signature_mismatch");
  });

  test("rejette les signatures vides, absentes ou malformées", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    assert.equal(
      verifyGeniusPayWebhookSignature({
        rawBody: samplePayload,
        signature: "",
        timestamp,
        secret: TEST_SECRET,
      }).valid,
      false,
    );

    assert.equal(
      verifyGeniusPayWebhookSignature({
        rawBody: samplePayload,
        signature: null,
        timestamp,
        secret: TEST_SECRET,
      }).valid,
      false,
    );

    assert.equal(
      verifyGeniusPayWebhookSignature({
        rawBody: samplePayload,
        signature: "signature_invalide",
        timestamp: "non-nombre",
        secret: TEST_SECRET,
      }).valid,
      false,
    );
  });
});

describe("GeniusPay — Statuts des événements Webhook", () => {
  test("mappe correctement les événements de notification officiels GeniusPay", () => {
    assert.equal(mapGeniusPayEventToStatus("payment.success"), "paid");
    assert.equal(mapGeniusPayEventToStatus("payment.succeeded"), "paid");
    assert.equal(mapGeniusPayEventToStatus("payment.failed"), "failed");
    assert.equal(mapGeniusPayEventToStatus("payment.cancelled"), "cancelled");
    assert.equal(mapGeniusPayEventToStatus("payment.canceled"), "cancelled");
    assert.equal(mapGeniusPayEventToStatus("payment.refunded"), "refunded");
    assert.equal(mapGeniusPayEventToStatus("payment.expired"), "expired");
    assert.equal(mapGeniusPayEventToStatus("payment.processing"), "processing");
  });

  test("ignore et renvoie null pour les événements hors périmètre", () => {
    assert.equal(mapGeniusPayEventToStatus("payout.completed"), null);
    assert.equal(mapGeniusPayEventToStatus("customer.created"), null);
    assert.equal(mapGeniusPayEventToStatus("unknown.event"), null);
  });
});

describe("GeniusPay — Création de paiement et Checkout hébergé", () => {
  test("génère une URL de sandbox simulée en mode développement quand les clés ne sont pas configurées", async () => {
    const res = await createGeniusPayPayment(
      {
        amount: 4500,
        currency: "XOF",
        description: "Commande Savora #TEST1234",
        customer: {
          name: "Koffi Mensah",
          phone: "+22890123456",
          email: "koffi@example.com",
        },
        success_url: "http://localhost:5173/paiement/succes?order_id=test-123",
        error_url: "http://localhost:5173/paiement/echec?order_id=test-123",
        metadata: {
          order_id: "test-order-123",
          payment_id: "test-payment-456",
          source: "savora",
        },
      },
      { apiKey: "", apiSecret: "" },
    );

    assert.equal(res.success, true);
    assert.equal(res.isSimulated, true);
    assert.match(res.checkoutUrl, /\/paiement\/simulation-geniuspay\?/);
    assert.match(res.checkoutUrl, /order_id=test-order-123/);
  });
});

describe("GeniusPay — Migration SQL & Intégrité Schéma", () => {
  test("la migration 013 autorise les méthodes GeniusPay et les statuts refunded/expired", () => {
    const sql = readFileSync(
      new URL("../database/migrations/013_geniuspay_payments.sql", import.meta.url),
      "utf8",
    );

    assert.match(sql, /geniuspay/i);
    assert.match(sql, /wave/i);
    assert.match(sql, /orange_money/i);
    assert.match(sql, /mtn/i);
    assert.match(sql, /moov/i);
    assert.match(sql, /refunded/i);
    assert.match(sql, /expired/i);
  });

  test("la migration 013 crée la table payment_events pour l'idempotence et l'audit", () => {
    const sql = readFileSync(
      new URL("../database/migrations/013_geniuspay_payments.sql", import.meta.url),
      "utf8",
    );

    assert.match(sql, /CREATE TABLE IF NOT EXISTS payment_events/i);
    assert.match(sql, /UNIQUE\s*\(provider,\s*event_id\)/i);
    assert.match(sql, /idx_payment_events_order_id/i);
  });
});
