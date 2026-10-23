import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  assertCompletedWeek,
  buildOrderStatusBreakdown,
  buildReportSummary,
  calculateAverage,
  canAccessReport,
  fillDailySeries,
  getWeekPeriod,
  isCronAuthorized,
  periodFromWeekStart,
  planReportGeneration,
  previousWeekPeriod,
  summarizePayments,
  type WeeklyReportData,
} from "../server/lib/reports.js";
import { buildWeeklyReportPdf } from "../server/lib/report-pdf.js";
import { can } from "../server/lib/permissions.js";

function sampleReport(): WeeklyReportData {
  return {
    restaurant: {
      name: "Maison Lumière",
      slug: "maison-lumiere",
      currency: "XOF",
    },
    period: { start: "2026-10-19", end: "2026-10-25" },
    generatedAt: "2026-10-26T06:00:00.000Z",
    orders: {
      total: 12,
      billable: 10,
      revenue: 87500,
      average: 8750,
      delivered: 5,
      cancelled: 2,
      paid: 6,
      awaitingPayment: 2,
      withoutOnlinePayment: 2,
      refunded: 0,
      byStatus: [
        { key: "pending", label: "En attente", count: 1 },
        { key: "confirmed", label: "Confirmée", count: 2 },
        { key: "preparing", label: "En préparation", count: 1 },
        { key: "ready", label: "Prête", count: 1 },
        { key: "delivering", label: "En livraison", count: 0 },
        { key: "delivered", label: "Livrée", count: 5 },
        { key: "cancelled", label: "Annulée", count: 2 },
      ],
    },
    payments: {
      totalCount: 9,
      paidAmount: 52500,
      pendingAmount: 17500,
      failedAmount: 5000,
      refundedAmount: 0,
      byStatus: [
        { key: "paid", label: "Payé", count: 6, amount: 52500 },
        { key: "pending", label: "En attente", count: 1, amount: 10000 },
        { key: "processing", label: "En cours", count: 1, amount: 7500 },
        { key: "failed", label: "Échoué", count: 1, amount: 5000 },
        { key: "refunded", label: "Remboursé", count: 0, amount: 0 },
      ],
      methods: [
        { method: "flooz", label: "Flooz", count: 4, amount: 35000 },
        { method: "tmoney", label: "T-Money", count: 2, amount: 17500 },
      ],
    },
    refunds: { count: 0, amount: 0, supported: false },
    daily: [
      { date: "2026-10-19", orders: 2, revenue: 15000 },
      { date: "2026-10-20", orders: 1, revenue: 7500 },
      { date: "2026-10-21", orders: 3, revenue: 22500 },
      { date: "2026-10-22", orders: 1, revenue: 8000 },
      { date: "2026-10-23", orders: 2, revenue: 16000 },
      { date: "2026-10-24", orders: 2, revenue: 11000 },
      { date: "2026-10-25", orders: 1, revenue: 7500 },
    ],
    topDishes: [
      { name: "Poulet Yassa", quantity: 14, revenue: 49000 },
      { name: "Bissap", quantity: 9, revenue: 4500 },
      { name: "Poisson braisé", quantity: 5, revenue: 25000 },
    ],
  };
}

describe("Rapports hebdomadaires — périodes", () => {
  test("calcule une semaine du lundi au dimanche en UTC", () => {
    assert.deepEqual(getWeekPeriod(new Date("2026-10-21T12:00:00Z")), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
    assert.deepEqual(getWeekPeriod(new Date("2026-10-19T00:00:00Z")), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
    assert.deepEqual(getWeekPeriod(new Date("2026-10-25T23:59:59Z")), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
  });

  test("calcule la semaine précédente, même si le cron est relancé un mardi", () => {
    assert.deepEqual(previousWeekPeriod(new Date("2026-10-26T06:00:00Z")), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
    assert.deepEqual(previousWeekPeriod(new Date("2026-10-27T09:30:00Z")), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
  });

  test("valide une date de début de semaine et refuse un jour non lundi", () => {
    assert.deepEqual(periodFromWeekStart("2026-10-19"), {
      start: "2026-10-19",
      end: "2026-10-25",
    });
    assert.throws(() => periodFromWeekStart("2026-10-20"), /lundi/);
    assert.throws(() => periodFromWeekStart("19/10/2026"), /invalide/);
  });

  test("refuse de générer une semaine non terminée", () => {
    const period = { start: "2026-10-19", end: "2026-10-25" };
    assert.doesNotThrow(() =>
      assertCompletedWeek(period, new Date("2026-10-26T06:00:00Z")),
    );
    assert.throws(() =>
      assertCompletedWeek(period, new Date("2026-10-25T23:00:00Z")),
    );
  });
});

describe("Rapports hebdomadaires — idempotence et sécurité", () => {
  test("ne régénère jamais un rapport terminé", () => {
    assert.equal(planReportGeneration(null), "generate");
    assert.equal(
      planReportGeneration({ status: "completed", updated_at: new Date() }),
      "skip",
    );
    assert.equal(
      planReportGeneration({ status: "failed", updated_at: new Date() }),
      "retry",
    );
    assert.equal(
      planReportGeneration({ status: "pending", updated_at: new Date() }),
      "retry",
    );
  });

  test("laisse un traitement récent se terminer, mais récupère un traitement bloqué", () => {
    const now = new Date("2026-10-26T06:00:00Z");
    assert.equal(
      planReportGeneration(
        {
          status: "processing",
          updated_at: new Date("2026-10-26T05:55:00Z"),
        },
        now,
      ),
      "skip",
    );
    assert.equal(
      planReportGeneration(
        {
          status: "processing",
          updated_at: new Date("2026-10-26T05:30:00Z"),
        },
        now,
      ),
      "retry",
    );
  });

  test("protège le cron avec un jeton Bearer et un secret non vide", () => {
    const secret = "un-secret-de-test-de-plus-de-32-caracteres";
    assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
    assert.equal(isCronAuthorized(`bearer ${secret}`, secret), true);
    assert.equal(isCronAuthorized("Bearer mauvais", secret), false);
    assert.equal(isCronAuthorized(null, secret), false);
    assert.equal(isCronAuthorized(`Basic ${secret}`, secret), false);
    assert.equal(isCronAuthorized(`Bearer ${secret}`, ""), false);
  });

  test("la migration interdit deux rapports pour le même restaurant et la même semaine", () => {
    const sql = readFileSync(
      new URL("../database/migrations/011_weekly_reports.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /UNIQUE\s*\(restaurant_id,\s*week_start\)/i);
    assert.match(sql, /file_data\s+BYTEA/i);
  });

  test("vercel.json planifie le cron du lundi", () => {
    const deployment = JSON.parse(
      readFileSync(new URL("../vercel.json", import.meta.url), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };
    assert.deepEqual(deployment.crons, [
      { path: "/api/cron/weekly-reports", schedule: "0 6 * * 1" },
    ]);
  });
});

describe("Rapports hebdomadaires — calculs", () => {
  test("calcule le panier moyen sans division par zéro", () => {
    assert.equal(calculateAverage(10000, 3), 3333.33);
    assert.equal(calculateAverage(0, 0), 0);
  });

  test("agrège les paiements sans double comptage et distingue les remboursements", () => {
    const summary = summarizePayments([
      { status: "paid", count: 2, amount: "10000" },
      { status: "pending", count: 1, amount: "5000" },
      { status: "processing", count: 1, amount: "2500" },
      { status: "failed", count: 1, amount: "3000" },
      { status: "cancelled", count: 1, amount: "1000" },
    ]);

    assert.equal(summary.totalCount, 6);
    assert.equal(summary.paidAmount, 10000);
    assert.equal(summary.pendingAmount, 7500);
    assert.equal(summary.failedAmount, 4000);
    assert.equal(summary.refundedAmount, 0);
    assert.equal(
      summary.byStatus.find((row) => row.key === "refunded")?.amount,
      0,
    );
    assert.equal(
      summary.byStatus.reduce((total, row) => total + row.count, 0),
      6,
    );
  });

  test("complète les sept jours même sans vente", () => {
    const period = { start: "2026-10-19", end: "2026-10-25" };
    const daily = fillDailySeries(
      [
        { date: "2026-10-19", orders: 2, revenue: "10000" },
        { date: "2026-10-21", orders: 1, revenue: 5000 },
      ],
      period,
    );

    assert.equal(daily.length, 7);
    assert.deepEqual(daily[0], {
      date: "2026-10-19",
      orders: 2,
      revenue: 10000,
    });
    assert.deepEqual(daily[1], {
      date: "2026-10-20",
      orders: 0,
      revenue: 0,
    });
    assert.deepEqual(daily[6], {
      date: "2026-10-25",
      orders: 0,
      revenue: 0,
    });
  });

  test("compte chaque commande une seule fois par statut", () => {
    const breakdown = buildOrderStatusBreakdown({
      total: 12,
      billable: 10,
      revenue: "87500",
      pending: 1,
      confirmed: 2,
      preparing: 1,
      ready: 1,
      delivering: 0,
      delivered: 5,
      cancelled: 2,
    });
    assert.equal(breakdown.reduce((sum, row) => sum + row.count, 0), 12);
    assert.equal(
      breakdown.find((row) => row.key === "cancelled")?.count,
      2,
    );
  });

  test("construit un résumé compact pour le tableau de bord", () => {
    assert.deepEqual(buildReportSummary(sampleReport()), {
      revenue: 87500,
      totalOrders: 12,
      averageOrder: 8750,
      paidOrders: 6,
      cancelledOrders: 2,
      paymentsPaid: 52500,
    });
  });

  test("le backend ne peut pas exposer le rapport d'un autre restaurant", () => {
    assert.equal(canAccessReport("restaurant-a", "restaurant-a"), true);
    assert.equal(canAccessReport("restaurant-a", "restaurant-b"), false);
  });

  test("la permission statistics est réservée aux rôles de gestion", () => {
    assert.equal(can("owner", "statistics"), true);
    assert.equal(can("admin", "statistics"), true);
    assert.equal(can("manager", "statistics"), true);
    assert.equal(can("cashier", "statistics"), false);
    assert.equal(can("kitchen", "statistics"), false);
    assert.equal(can("customer", "statistics"), false);
  });
});

describe("Rapports hebdomadaires — PDF", () => {
  test("génère un PDF valide avec le titre et les données du rapport", async () => {
    const bytes = await buildWeeklyReportPdf(sampleReport());

    assert.ok(bytes.length > 1000);
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString("utf8"), "%PDF-");

    const pdf = await PDFDocument.load(bytes);
    assert.ok(pdf.getPageCount() >= 1);
    assert.match(pdf.getTitle() ?? "", /Rapport hebdomadaire/);
    assert.match(pdf.getAuthor() ?? "", /Savora/);
  });
});
