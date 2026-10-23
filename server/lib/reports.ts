import { safeEqual } from "./http.js";

export type WeekPeriod = {
  /** Lundi, au format YYYY-MM-DD. */
  start: string;
  /** Dimanche, au format YYYY-MM-DD. */
  end: string;
};

export type ReportStatus = "pending" | "processing" | "completed" | "failed";

export type ReportGenerationPlan = "generate" | "retry" | "skip";

export type OrderStatusKey =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "delivering"
  | "delivered"
  | "cancelled";

export type PaymentStatusRow = {
  status: string;
  count: number | string;
  amount: number | string;
};

export type PaidMethodRow = {
  method: string;
  count: number | string;
  amount: number | string;
};

export type DailySalesRow = {
  date: string | Date;
  orders: number | string;
  revenue: number | string;
};

export type TopDishRow = {
  name: string;
  quantity: number | string;
  revenue: number | string;
};

export type ReportSummary = {
  revenue: number;
  totalOrders: number;
  averageOrder: number;
  paidOrders: number;
  cancelledOrders: number;
  paymentsPaid: number;
};

export type WeeklyReportData = {
  restaurant: {
    name: string;
    slug: string;
    currency: string;
  };
  period: WeekPeriod;
  generatedAt: string;
  orders: {
    total: number;
    billable: number;
    revenue: number;
    average: number;
    delivered: number;
    cancelled: number;
    paid: number;
    awaitingPayment: number;
    withoutOnlinePayment: number;
    refunded: number;
    byStatus: Array<{ key: OrderStatusKey; label: string; count: number }>;
  };
  payments: {
    totalCount: number;
    paidAmount: number;
    pendingAmount: number;
    failedAmount: number;
    refundedAmount: number;
    byStatus: Array<{
      key: string;
      label: string;
      count: number;
      amount: number;
    }>;
    methods: Array<{
      method: string;
      label: string;
      count: number;
      amount: number;
    }>;
  };
  refunds: {
    count: number;
    amount: number;
    /** Le schéma actuel ne possède pas encore de statut « refunded ». */
    supported: boolean;
  };
  daily: Array<{ date: string; orders: number; revenue: number }>;
  topDishes: Array<{ name: string; quantity: number; revenue: number }>;
};

export const ORDER_STATUS_LABELS: Record<OrderStatusKey, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  preparing: "En préparation",
  ready: "Prête",
  delivering: "En livraison",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  paid: "Payé",
  pending: "En attente",
  processing: "En cours",
  failed: "Échoué",
  cancelled: "Annulé",
  refunded: "Remboursé",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  flooz: "Flooz",
  tmoney: "T-Money",
};

const DAY_MS = 86_400_000;
const FRENCH_DAYS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return toIsoDate(parsed) === value ? parsed : null;
}

export function addDays(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  if (!date) throw new Error("Date invalide.");
  return toIsoDate(new Date(date.getTime() + days * DAY_MS));
}

/**
 * Semaine ISO « lundi → dimanche », calculée en UTC.
 * Savora cible l'Afrique de l'Ouest (UTC+0), ce qui rend les bornes non ambiguës.
 */
export function getWeekPeriod(date: Date = new Date()): WeekPeriod {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const daysSinceMonday = (day.getUTCDay() + 6) % 7;
  const start = new Date(day.getTime() - daysSinceMonday * DAY_MS);
  return {
    start: toIsoDate(start),
    end: toIsoDate(new Date(start.getTime() + 6 * DAY_MS)),
  };
}

export function previousWeekPeriod(date: Date = new Date()): WeekPeriod {
  const current = getWeekPeriod(date);
  const start = addDays(current.start, -7);
  return { start, end: addDays(start, 6) };
}

export function periodFromWeekStart(weekStart: string): WeekPeriod {
  const start = parseIsoDate(weekStart);
  if (!start) throw new Error("Date de début invalide (format attendu : AAAA-MM-JJ).");
  if (start.getUTCDay() !== 1) {
    throw new Error("La période doit commencer un lundi.");
  }
  return { start: weekStart, end: addDays(weekStart, 6) };
}

export function assertCompletedWeek(period: WeekPeriod, now: Date = new Date()): void {
  if (period.end >= toIsoDate(now)) {
    throw new Error("La semaine n'est pas encore terminée.");
  }
}

export function formatDateFr(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTimeFr(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return "—";
  const iso = date.toISOString();
  return `${formatDateFr(iso)} à ${iso.slice(11, 16)} UTC`;
}

export function formatWeekLabel(period: WeekPeriod): string {
  const start = parseIsoDate(period.start);
  const end = parseIsoDate(period.end);
  if (!start || !end) return `${period.start} → ${period.end}`;
  return `du ${FRENCH_DAYS[start.getUTCDay()]} ${formatDateFr(period.start)} au ${FRENCH_DAYS[end.getUTCDay()]} ${formatDateFr(period.end)}`;
}

export function isCronAuthorized(
  authorization: string | null,
  secret: string,
): boolean {
  if (!secret || !authorization) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  return safeEqual(match[1], secret);
}

/**
 * Décide quoi faire d'un rapport existant.
 * - terminé : ne jamais régénérer (pas de doublon) ;
 * - en cours depuis moins de 15 min : laisser le premier exécutant finir ;
 * - échoué, en attente ou « en cours » bloqué : relancer.
 */
export function planReportGeneration(
  existing:
    | { status: ReportStatus; updated_at: string | Date }
    | null
    | undefined,
  now: Date = new Date(),
  staleMinutes = 15,
): ReportGenerationPlan {
  if (!existing) return "generate";
  if (existing.status === "completed") return "skip";
  if (existing.status === "processing") {
    const updated = new Date(existing.updated_at).getTime();
    const ageMs = now.getTime() - updated;
    if (Number.isFinite(updated) && ageMs < staleMinutes * 60_000) return "skip";
  }
  return "retry";
}

export function toNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateAverage(revenue: number, billableOrders: number): number {
  if (billableOrders <= 0) return 0;
  return roundMoney(revenue / billableOrders);
}

export function summarizePayments(rows: PaymentStatusRow[]): {
  totalCount: number;
  paidAmount: number;
  pendingAmount: number;
  failedAmount: number;
  refundedAmount: number;
  byStatus: WeeklyReportData["payments"]["byStatus"];
} {
  const totals = new Map<string, { count: number; amount: number }>();

  for (const row of rows) {
    const current = totals.get(row.status) ?? { count: 0, amount: 0 };
    current.count += toNumber(row.count);
    current.amount += toNumber(row.amount);
    totals.set(row.status, current);
  }

  const statusOrder = [
    "paid",
    "pending",
    "processing",
    "failed",
    "cancelled",
    "refunded",
  ];

  const byStatus = statusOrder
    .filter((status) => (totals.get(status)?.count ?? 0) > 0 || status === "refunded")
    .map((status) => ({
      key: status,
      label: PAYMENT_STATUS_LABELS[status] ?? status,
      count: totals.get(status)?.count ?? 0,
      amount: roundMoney(totals.get(status)?.amount ?? 0),
    }));

  const value = (status: string) => totals.get(status) ?? { count: 0, amount: 0 };
  const refunded = value("refunded");

  return {
    totalCount: Array.from(totals.values()).reduce((sum, item) => sum + item.count, 0),
    paidAmount: roundMoney(value("paid").amount),
    pendingAmount: roundMoney(value("pending").amount + value("processing").amount),
    failedAmount: roundMoney(value("failed").amount + value("cancelled").amount),
    refundedAmount: roundMoney(refunded.amount),
    byStatus,
  };
}

export function buildOrderStatusBreakdown(
  row: Record<string, unknown>,
): WeeklyReportData["orders"]["byStatus"] {
  return (Object.keys(ORDER_STATUS_LABELS) as OrderStatusKey[]).map((key) => ({
    key,
    label: ORDER_STATUS_LABELS[key],
    count: toNumber(row[key]),
  }));
}

export function fillDailySeries(
  rows: DailySalesRow[],
  period: WeekPeriod,
): WeeklyReportData["daily"] {
  const byDate = new Map<string, DailySalesRow>();
  for (const row of rows) {
    const date =
      row.date instanceof Date
        ? toIsoDate(row.date)
        : String(row.date).slice(0, 10);
    byDate.set(date, row);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(period.start, index);
    const row = byDate.get(date);
    return {
      date,
      orders: toNumber(row?.orders),
      revenue: roundMoney(toNumber(row?.revenue)),
    };
  });
}

export function normalizeTopDishes(rows: TopDishRow[]): WeeklyReportData["topDishes"] {
  return rows.map((row) => ({
    name: String(row.name ?? "Plat supprimé"),
    quantity: toNumber(row.quantity),
    revenue: roundMoney(toNumber(row.revenue)),
  }));
}

export function buildReportSummary(data: WeeklyReportData): ReportSummary {
  return {
    revenue: data.orders.revenue,
    totalOrders: data.orders.total,
    averageOrder: data.orders.average,
    paidOrders: data.orders.paid,
    cancelledOrders: data.orders.cancelled,
    paymentsPaid: data.payments.paidAmount,
  };
}

/**
 * Défense en profondeur : même si une requête SQL oubliait le filtre,
 * un rapport d'un autre restaurant ne doit jamais être exposé.
 */
export function canAccessReport(
  reportRestaurantId: string,
  currentRestaurantId: string,
): boolean {
  return reportRestaurantId === currentRestaurantId;
}
