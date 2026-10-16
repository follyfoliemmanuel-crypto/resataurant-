import { query } from "./db.js";

export type Plan = "starter" | "business" | "pro";

export const PLAN_FEATURES: Record<Plan, string[]> = {
  starter: ["menu", "cart", "whatsapp_order"],
  business: [
    "menu",
    "cart",
    "whatsapp_order",
    "dashboard",
    "orders",
    "products",
    "categories",
    "customers",
    "statistics",
    "settings",
    "auth",
  ],
  pro: [
    "menu",
    "cart",
    "whatsapp_order",
    "dashboard",
    "orders",
    "products",
    "categories",
    "customers",
    "statistics",
    "settings",
    "auth",
    "stock",
    "promotions",
    "staff",
    "audit",
    "notifications",
    "delivery",
  ],
};

export function hasFeature(plan: Plan, feature: string) {
  return PLAN_FEATURES[plan]?.includes(feature) ?? false;
}

export async function getRestaurantBySlug(slug: string) {
  const result = await query<{
    id: string;
    slug: string;
    plan: Plan;
    is_active: boolean;
  }>(
    "SELECT id, slug, plan, is_active FROM restaurants WHERE slug = $1 LIMIT 1",
    [slug],
  );
  return result.rows[0] ?? null;
}

export type RoleName = "owner" | "admin" | "manager" | "cashier" | "kitchen" | "customer";

const ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  owner: ["*"],
  admin: [
    "orders",
    "products",
    "categories",
    "customers",
    "stock",
    "promotions",
    "statistics",
    "staff",
    "notifications",
    "settings",
    "audit",
    "account",
  ],
  manager: ["orders", "products", "categories", "statistics", "account"],
  cashier: ["orders", "account"],
  kitchen: ["orders:kitchen", "account"],
  customer: ["account"],
};

export function can(role: RoleName, permission: string) {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  if (granted.includes("*")) return true;
  if (granted.includes(permission)) return true;
  if (permission.startsWith("orders") && granted.includes("orders")) return true;
  return false;
}

export function isStaff(role: RoleName) {
  return role !== "customer";
}
