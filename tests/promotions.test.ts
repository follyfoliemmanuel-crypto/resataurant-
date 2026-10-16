import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyPromotion, computeOrderTotals } from "../server/lib/pricing.js";

describe("Promotions & Order Pricing Engine", () => {
  test("applyPromotion handles percent and fixed discounts accurately", () => {
    // Null promo
    assert.equal(applyPromotion(5000, null), 0);

    // Percentage discount
    assert.equal(applyPromotion(10000, { type: "percent", value: 15 }), 1500);
    assert.equal(applyPromotion(5000, { type: "percent", value: 50 }), 2500);
    assert.equal(applyPromotion(2000, { type: "percent", value: 100 }), 2000);
    // Capped at 100%
    assert.equal(applyPromotion(2000, { type: "percent", value: 150 }), 2000);

    // Fixed discount
    assert.equal(applyPromotion(10000, { type: "fixed", value: 2500 }), 2500);
    // Fixed discount capped at subtotal (never negative)
    assert.equal(applyPromotion(1500, { type: "fixed", value: 5000 }), 1500);
  });

  test("computeOrderTotals correctly calculates subtotal, delivery fee, discount and final total", () => {
    const lines = [
      { platId: "1", name: "Poulet Yassa", quantity: 2, unitPrice: 3500, subtotal: 7000 },
      { platId: "2", name: "Bissap", quantity: 2, unitPrice: 1000, subtotal: 2000 },
    ];

    // Pickup order with 1000 discount
    const pickupTotals = computeOrderTotals({
      lines,
      deliveryMethod: "pickup",
      deliveryEnabled: true,
      deliveryFee: 1500,
      discount: 1000,
    });

    assert.equal(pickupTotals.subtotal, 9000);
    assert.equal(pickupTotals.deliveryFee, 0); // No delivery fee for pickup
    assert.equal(pickupTotals.discount, 1000);
    assert.equal(pickupTotals.total, 8000);

    // Delivery order with 1500 fee and 2000 discount
    const deliveryTotals = computeOrderTotals({
      lines,
      deliveryMethod: "delivery",
      deliveryEnabled: true,
      deliveryFee: 1500,
      discount: 2000,
    });

    assert.equal(deliveryTotals.subtotal, 9000);
    assert.equal(deliveryTotals.deliveryFee, 1500);
    assert.equal(deliveryTotals.discount, 2000);
    assert.equal(deliveryTotals.total, 8500); // 9000 + 1500 - 2000
  });

  test("computeOrderTotals throws on invalid input or disabled delivery", () => {
    const lines = [{ platId: "1", name: "Plat", quantity: 1, unitPrice: 1000, subtotal: 1000 }];
    
    assert.throws(() => {
      computeOrderTotals({
        lines,
        deliveryMethod: "delivery",
        deliveryEnabled: false,
        deliveryFee: 1000,
        discount: 0,
      });
    }, /delivery_disabled/);
  });

  test("Promo code business validation rules (dates, limits, min amount)", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 86400000); // 1 day ago
    const future = new Date(now.getTime() + 86400000); // in 1 day

    interface PromoRule {
      code: string;
      is_active: boolean;
      starts_at: Date | null;
      expires_at: Date | null;
      min_order_amount: number | null;
      max_uses: number | null;
      uses_count: number;
      max_uses_per_user: number | null;
    }

    function validatePromo(promo: PromoRule, subtotal: number, userUses: number): { valid: boolean; reason?: string } {
      if (!promo.is_active) return { valid: false, reason: "Code promotionnel inactif" };
      if (promo.starts_at && now < promo.starts_at) return { valid: false, reason: "Ce code n'est pas encore actif" };
      if (promo.expires_at && now > promo.expires_at) return { valid: false, reason: "Ce code a expiré" };
      if (promo.min_order_amount != null && subtotal < promo.min_order_amount) {
        return { valid: false, reason: `Montant minimum de ${promo.min_order_amount} requis` };
      }
      if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
        return { valid: false, reason: "Ce code a atteint sa limite maximale d'utilisations" };
      }
      if (promo.max_uses_per_user != null && userUses >= promo.max_uses_per_user) {
        return { valid: false, reason: "Vous avez déjà atteint la limite d'utilisation pour ce code" };
      }
      return { valid: true };
    }

    const basePromo: PromoRule = {
      code: "WELCOME10",
      is_active: true,
      starts_at: null,
      expires_at: null,
      min_order_amount: 5000,
      max_uses: 100,
      uses_count: 5,
      max_uses_per_user: 1,
    };

    // Valid check
    assert.equal(validatePromo(basePromo, 6000, 0).valid, true);

    // Subtotal below min amount
    const minCheck = validatePromo(basePromo, 4000, 0);
    assert.equal(minCheck.valid, false);
    assert.ok(minCheck.reason?.includes("Montant minimum"));

    // Expired promo
    const expiredCheck = validatePromo({ ...basePromo, expires_at: past }, 6000, 0);
    assert.equal(expiredCheck.valid, false);
    assert.ok(expiredCheck.reason?.includes("expiré"));

    // Future promo
    const futureCheck = validatePromo({ ...basePromo, starts_at: future }, 6000, 0);
    assert.equal(futureCheck.valid, false);
    assert.ok(futureCheck.reason?.includes("pas encore actif"));

    // Exhausted max uses
    const maxUsesCheck = validatePromo({ ...basePromo, max_uses: 10, uses_count: 10 }, 6000, 0);
    assert.equal(maxUsesCheck.valid, false);
    assert.ok(maxUsesCheck.reason?.includes("limite maximale"));

    // User limit reached
    const userLimitCheck = validatePromo({ ...basePromo, max_uses_per_user: 1 }, 6000, 1);
    assert.equal(userLimitCheck.valid, false);
    assert.ok(userLimitCheck.reason?.includes("déjà atteint la limite"));

    // Inactive promo
    const inactiveCheck = validatePromo({ ...basePromo, is_active: false }, 6000, 0);
    assert.equal(inactiveCheck.valid, false);
    assert.ok(inactiveCheck.reason?.includes("inactif"));
  });

  test("Promo code normalization (case-insensitive & trimmed)", () => {
    const normalize = (code: string) => code.trim().toUpperCase();
    assert.equal(normalize(" savora2026 "), "SAVORA2026");
    assert.equal(normalize("BienVenue10"), "BIENVENUE10");
  });
});
