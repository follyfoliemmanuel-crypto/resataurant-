import { query } from "./db.js";
import { HttpError } from "./http.js";
import { buildWeeklyReportPdf } from "./report-pdf.js";
import {
  assertCompletedWeek,
  buildOrderStatusBreakdown,
  buildReportSummary,
  calculateAverage,
  canAccessReport,
  fillDailySeries,
  normalizeTopDishes,
  planReportGeneration,
  roundMoney,
  summarizePayments,
  toNumber,
  type DailySalesRow,
  type PaidMethodRow,
  type PaymentStatusRow,
  type ReportStatus,
  type TopDishRow,
  type WeekPeriod,
  type WeeklyReportData,
} from "./reports.js";

export type ReportTrigger = "cron" | "manual";

export type ReportMetadata = {
  id: string;
  week_start: string;
  week_end: string;
  status: ReportStatus;
  file_name: string | null;
  size_bytes: number | null;
  summary: Record<string, unknown> | null;
  generated_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
};

type ReportMetadataDbRow = {
  id: string;
  restaurant_id: string;
  week_start: string;
  week_end: string;
  status: ReportStatus;
  file_name: string | null;
  size_bytes: number | null;
  summary: Record<string, unknown> | null;
  generated_at: Date | string | null;
  attempts: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type OrderSummaryDbRow = {
  total: number;
  billable: number;
  revenue: string;
  pending: number;
  confirmed: number;
  preparing: number;
  ready: number;
  delivering: number;
  delivered: number;
  cancelled: number;
};

type PaymentCoverageDbRow = {
  paid_orders: number;
  awaiting_orders: number;
  without_payment: number;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapReport(row: ReportMetadataDbRow): ReportMetadata {
  return {
    id: row.id,
    week_start: String(row.week_start).slice(0, 10),
    week_end: String(row.week_end).slice(0, 10),
    status: row.status,
    file_name: row.file_name,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    summary: row.summary,
    generated_at: row.generated_at ? iso(row.generated_at) : null,
    attempts: Number(row.attempts ?? 0),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

async function getRestaurantProfile(restaurantId: string): Promise<{
  name: string;
  slug: string;
  currency: string;
}> {
  const result = await query<{
    name: string;
    slug: string;
    currency: string;
  }>(
    `SELECT COALESCE(s.restaurant_name, r.slug) AS name,
            r.slug,
            COALESCE(s.currency, 'XOF') AS currency
     FROM restaurants r
     LEFT JOIN restaurant_settings s ON s.restaurant_id = r.id
     WHERE r.id = $1
     LIMIT 1`,
    [restaurantId],
  );

  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Restaurant introuvable.");
  return {
    name: row.name,
    slug: row.slug,
    currency: row.currency,
  };
}

export async function buildWeeklyReportData(
  restaurantId: string,
  period: WeekPeriod,
  generatedAt = new Date().toISOString(),
): Promise<WeeklyReportData> {
  const [profile, ordersRes, coverageRes, paymentRes, methodRes, dailyRes, dishesRes] =
    await Promise.all([
      getRestaurantProfile(restaurantId),
      query<OrderSummaryDbRow>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS billable,
                COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
                COUNT(*) FILTER (WHERE status = 'preparing')::int AS preparing,
                COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
                COUNT(*) FILTER (WHERE status = 'delivering')::int AS delivering,
                COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM orders
         WHERE restaurant_id = $1
           AND created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')`,
        [restaurantId, period.start, period.end],
      ),
      query<PaymentCoverageDbRow>(
        `SELECT COUNT(*) FILTER (WHERE has_paid)::int AS paid_orders,
                COUNT(*) FILTER (WHERE NOT has_paid AND has_pending)::int AS awaiting_orders,
                COUNT(*) FILTER (WHERE NOT has_paid AND NOT has_pending)::int AS without_payment
         FROM (
           SELECT o.id,
                  COALESCE(bool_or(p.status = 'paid'), FALSE) AS has_paid,
                  COALESCE(bool_or(p.status IN ('pending', 'processing')), FALSE) AS has_pending
           FROM orders o
           LEFT JOIN payments p ON p.order_id = o.id
           WHERE o.restaurant_id = $1
             AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
             AND o.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
             AND o.status <> 'cancelled'
           GROUP BY o.id
         ) coverage`,
        [restaurantId, period.start, period.end],
      ),
      query<PaymentStatusRow>(
        `SELECT p.status,
                COUNT(*)::int AS count,
                COALESCE(SUM(p.amount), 0)::numeric AS amount
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.restaurant_id = $1
           AND p.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND p.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
         GROUP BY p.status`,
        [restaurantId, period.start, period.end],
      ),
      query<PaidMethodRow>(
        `SELECT p.payment_method AS method,
                COUNT(*)::int AS count,
                COALESCE(SUM(p.amount), 0)::numeric AS amount
         FROM payments p
         JOIN orders o ON o.id = p.order_id
         WHERE o.restaurant_id = $1
           AND p.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND p.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
           AND p.status = 'paid'
         GROUP BY p.payment_method
         ORDER BY amount DESC`,
        [restaurantId, period.start, period.end],
      ),
      query<DailySalesRow>(
        `WITH days AS (
           SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
         )
         SELECT days.day AS date,
                COUNT(o.id)::int AS orders,
                COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'cancelled'), 0)::numeric AS revenue
         FROM days
         LEFT JOIN orders o
           ON o.restaurant_id = $1
          AND o.created_at >= (days.day::timestamp AT TIME ZONE 'UTC')
          AND o.created_at < ((days.day + 1)::timestamp AT TIME ZONE 'UTC')
         GROUP BY days.day
         ORDER BY days.day`,
        [restaurantId, period.start, period.end],
      ),
      query<TopDishRow>(
        `SELECT p.name,
                SUM(oi.quantity)::int AS quantity,
                COALESCE(SUM(oi.subtotal), 0)::numeric AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN plats p ON p.id = oi.plat_id
         WHERE o.restaurant_id = $1
           AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'UTC')
           AND o.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'UTC')
           AND o.status <> 'cancelled'
         GROUP BY p.id, p.name
         ORDER BY quantity DESC, revenue DESC
         LIMIT 10`,
        [restaurantId, period.start, period.end],
      ),
    ]);

  const ordersRow = ordersRes.rows[0] ?? {
    total: 0,
    billable: 0,
    revenue: "0",
    pending: 0,
    confirmed: 0,
    preparing: 0,
    ready: 0,
    delivering: 0,
    delivered: 0,
    cancelled: 0,
  };
  const coverage = coverageRes.rows[0] ?? {
    paid_orders: 0,
    awaiting_orders: 0,
    without_payment: 0,
  };

  const revenue = roundMoney(toNumber(ordersRow.revenue));
  const billable = toNumber(ordersRow.billable);
  const paymentSummary = summarizePayments(paymentRes.rows);

  return {
    restaurant: profile,
    period,
    generatedAt,
    orders: {
      total: toNumber(ordersRow.total),
      billable,
      revenue,
      average: calculateAverage(revenue, billable),
      delivered: toNumber(ordersRow.delivered),
      cancelled: toNumber(ordersRow.cancelled),
      paid: toNumber(coverage.paid_orders),
      awaitingPayment: toNumber(coverage.awaiting_orders),
      withoutOnlinePayment: toNumber(coverage.without_payment),
      refunded: 0,
      byStatus: buildOrderStatusBreakdown(ordersRow),
    },
    payments: {
      ...paymentSummary,
      methods: methodRes.rows.map((row) => ({
        method: row.method,
        label:
          row.method === "flooz"
            ? "Flooz"
            : row.method === "tmoney"
              ? "T-Money"
              : row.method,
        count: toNumber(row.count),
        amount: roundMoney(toNumber(row.amount)),
      })),
    },
    refunds: {
      count: 0,
      amount: paymentSummary.refundedAmount,
      supported: false,
    },
    daily: fillDailySeries(dailyRes.rows, period),
    topDishes: normalizeTopDishes(dishesRes.rows),
  };
}

async function findReport(
  restaurantId: string,
  weekStart: string,
): Promise<ReportMetadataDbRow | null> {
  const result = await query<ReportMetadataDbRow>(
    `SELECT id, restaurant_id, week_start::text AS week_start, week_end::text AS week_end,
            status, file_name, size_bytes, summary, generated_at, attempts,
            created_at, updated_at
     FROM weekly_reports
     WHERE restaurant_id = $1 AND week_start = $2::date
     LIMIT 1`,
    [restaurantId, weekStart],
  );
  return result.rows[0] ?? null;
}

async function findReportById(
  restaurantId: string,
  reportId: string,
): Promise<ReportMetadataDbRow | null> {
  const result = await query<ReportMetadataDbRow>(
    `SELECT id, restaurant_id, week_start::text AS week_start, week_end::text AS week_end,
            status, file_name, size_bytes, summary, generated_at, attempts,
            created_at, updated_at
     FROM weekly_reports
     WHERE id = $1 AND restaurant_id = $2
     LIMIT 1`,
    [reportId, restaurantId],
  );
  return result.rows[0] ?? null;
}

export type GenerateWeeklyReportResult = {
  status: "generated" | "skipped";
  report: ReportMetadata;
};

/**
 * Génère un rapport de façon idempotente.
 * La contrainte UNIQUE (restaurant_id, week_start) et le passage atomique
 * en statut « processing » empêchent deux exécutions concurrentes de produire
 * deux PDF pour la même semaine.
 */
export async function generateWeeklyReport(
  restaurantId: string,
  period: WeekPeriod,
  trigger: ReportTrigger,
): Promise<GenerateWeeklyReportResult> {
  try {
    assertCompletedWeek(period);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Période invalide.",
      "invalid_period",
    );
  }

  const existing = await findReport(restaurantId, period.start);
  const plan = planReportGeneration(existing);

  if (plan === "skip" && existing) {
    return { status: "skipped", report: mapReport(existing) };
  }

  const claimed = await query<ReportMetadataDbRow>(
    `INSERT INTO weekly_reports
       (restaurant_id, week_start, week_end, status, generated_by, attempts)
     VALUES ($1, $2::date, $3::date, 'processing', $4, 1)
     ON CONFLICT (restaurant_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end,
       status = 'processing',
       generated_by = EXCLUDED.generated_by,
       attempts = weekly_reports.attempts + 1,
       error_message = NULL,
       file_data = NULL,
       file_name = NULL,
       size_bytes = NULL,
       summary = NULL,
       generated_at = NULL,
       updated_at = now()
     WHERE weekly_reports.status IN ('pending', 'failed')
        OR (
          weekly_reports.status = 'processing'
          AND weekly_reports.updated_at < now() - interval '15 minutes'
        )
     RETURNING id, restaurant_id, week_start::text AS week_start, week_end::text AS week_end,
               status, file_name, size_bytes, summary, generated_at, attempts,
               created_at, updated_at`,
    [restaurantId, period.start, period.end, trigger],
  );

  const report = claimed.rows[0];
  if (!report) {
    // Un autre exécutant a terminé ou est encore en train de générer.
    const current = await findReport(restaurantId, period.start);
    if (!current) {
      throw new HttpError(500, "Impossible de réserver la génération du rapport.");
    }
    return { status: "skipped", report: mapReport(current) };
  }

  try {
    const data = await buildWeeklyReportData(restaurantId, period);
    const pdf = await buildWeeklyReportPdf(data);
    const buffer = Buffer.from(pdf);
    const safeSlug = data.restaurant.slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    const fileName = `savora-rapport-${safeSlug}-${period.start}.pdf`;
    const summary = buildReportSummary(data);

    await query(
      `UPDATE weekly_reports
       SET status = 'completed',
           file_data = $1,
           file_name = $2,
           size_bytes = $3,
           summary = $4::jsonb,
           generated_at = now(),
           error_message = NULL,
           updated_at = now()
       WHERE id = $5 AND restaurant_id = $6`,
      [buffer, fileName, buffer.length, JSON.stringify(summary), report.id, restaurantId],
    );

    const completed = await findReportById(restaurantId, report.id);
    if (!completed) {
      throw new Error("Rapport terminé mais introuvable.");
    }

    return { status: "generated", report: mapReport(completed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    console.error(
      `[weekly-report] échec restaurant=${restaurantId} semaine=${period.start}:`,
      message,
    );
    await query(
      `UPDATE weekly_reports
       SET status = 'failed', error_message = $1, updated_at = now()
       WHERE id = $2 AND restaurant_id = $3`,
      [message.slice(0, 1000), report.id, restaurantId],
    ).catch((updateError) => {
      console.error("[weekly-report] impossible de marquer le rapport en échec:", updateError);
    });

    throw new HttpError(
      500,
      "La génération du rapport a échoué. Réessayez depuis le tableau de bord.",
      "report_generation_failed",
    );
  }
}

export async function generateAllWeeklyReports(
  period: WeekPeriod,
  trigger: ReportTrigger = "cron",
): Promise<{
  generated: number;
  skipped: number;
  failed: number;
  results: Array<{
    restaurantId: string;
    status: "generated" | "skipped" | "failed";
  }>;
}> {
  const restaurants = await query<{ id: string }>(
    `SELECT id FROM restaurants WHERE is_active = TRUE ORDER BY created_at ASC`,
  );

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<{
    restaurantId: string;
    status: "generated" | "skipped" | "failed";
  }> = [];

  for (const restaurant of restaurants.rows) {
    try {
      const result = await generateWeeklyReport(restaurant.id, period, trigger);
      if (result.status === "generated") generated += 1;
      else skipped += 1;
      results.push({ restaurantId: restaurant.id, status: result.status });
    } catch (error) {
      failed += 1;
      console.error(
        `[weekly-report] restaurant=${restaurant.id} échec:`,
        error instanceof Error ? error.message : error,
      );
      results.push({ restaurantId: restaurant.id, status: "failed" });
    }
  }

  return { generated, skipped, failed, results };
}

export async function listWeeklyReports(
  restaurantId: string,
): Promise<ReportMetadata[]> {
  const result = await query<ReportMetadataDbRow>(
    `SELECT id, restaurant_id, week_start::text AS week_start, week_end::text AS week_end,
            status, file_name, size_bytes, summary, generated_at, attempts,
            created_at, updated_at
     FROM weekly_reports
     WHERE restaurant_id = $1
     ORDER BY week_start DESC
     LIMIT 52`,
    [restaurantId],
  );
  return result.rows.map(mapReport);
}

export async function getWeeklyReportFile(
  restaurantId: string,
  reportId: string,
): Promise<{ fileName: string; data: Buffer }> {
  const result = await query<{
    restaurant_id: string;
    file_name: string | null;
    file_data: Buffer | null;
  }>(
    `SELECT restaurant_id, file_name, file_data
     FROM weekly_reports
     WHERE id = $1 AND restaurant_id = $2 AND status = 'completed'
     LIMIT 1`,
    [reportId, restaurantId],
  );

  const row = result.rows[0];
  if (!row || !row.file_data) {
    throw new HttpError(404, "Rapport introuvable.", "report_not_found");
  }
  if (!canAccessReport(row.restaurant_id, restaurantId)) {
    throw new HttpError(404, "Rapport introuvable.", "report_not_found");
  }

  return {
    fileName: row.file_name || `savora-rapport-${reportId}.pdf`,
    data: Buffer.isBuffer(row.file_data)
      ? row.file_data
      : Buffer.from(row.file_data),
  };
}
