export interface Category {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  position: number;
}

export interface Plat {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string | number;
  image_url: string | null;
  is_available: boolean;
  is_popular: boolean;
  position: number;
  stock_quantity?: number;
}

export interface RestaurantSettings {
  id: string;
  slug: string;
  restaurant_name: string;
  logo_url: string | null;
  description: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  currency: string;
  primary_color: string;
  secondary_color: string;
  delivery_enabled: boolean;
  delivery_fee: string | number;
  opening_hours: Record<string, { open?: string; close?: string; closed?: boolean }>;
}

export interface CartItem {
  plat: Plat;
  quantity: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Order {
  id: string;
  order_number: string;
  client_id: string;
  client_name?: string;
  client_phone?: string;
  client_address?: string;
  subtotal: number | string;
  delivery_fee: number | string;
  discount: number | string;
  total: number | string;
  delivery_method: "pickup" | "delivery";
  delivery_address: string | null;
  note: string | null;
  status: "pending" | "confirmed" | "preparing" | "ready" | "delivering" | "delivered" | "cancelled";
  created_at: string;
}

export interface DashboardStats {
  summary: {
    total_orders: string | number;
    total_revenue: string | number;
    pending_orders: string | number;
    delivered_orders: string | number;
  };
  recentOrders: Order[];
  popularPlats: { name: string; total_sold: string; total_revenue: string }[];
}

export interface Promotion {
  id: string;
  restaurant_id?: string;
  name: string;
  code: string;
  type: "percent" | "fixed";
  value: number | string;
  min_order_amount: number | string | null;
  max_uses: number | null;
  max_uses_per_user: number | null;
  uses_count: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface WeeklyReport {
  id: string;
  week_start: string;
  week_end: string;
  status: "pending" | "processing" | "completed" | "failed";
  file_name: string | null;
  size_bytes: number | null;
  summary: {
    revenue?: number;
    totalOrders?: number;
    averageOrder?: number;
    paidOrders?: number;
    cancelledOrders?: number;
    paymentsPaid?: number;
  } | null;
  generated_at: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

