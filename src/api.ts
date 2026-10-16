import type { Category, Plat, RestaurantSettings, AuthUser, DashboardStats, Order, Promotion } from './types';

const BASE_URL = '/api';

export async function fetchRestaurant(): Promise<RestaurantSettings | null> {
  try {
    const res = await fetch(`${BASE_URL}/restaurant`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.restaurant;
  } catch (err) {
    console.error('fetchRestaurant error:', err);
    return null;
  }
}

export async function fetchMenu(): Promise<{ categories: Category[]; plats: Plat[]; ok: boolean }> {
  try {
    const res = await fetch(`${BASE_URL}/menu`, { cache: 'no-store' });
    if (!res.ok) return { categories: [], plats: [], ok: false };
    const data = await res.json();
    return {
      categories: data.categories || [],
      plats: data.plats || [],
      ok: true,
    };
  } catch (err) {
    console.error('fetchMenu error:', err);
    return { categories: [], plats: [], ok: false };
  }
}

export async function checkPromo(
  code: string,
  subtotal?: number,
  email?: string,
): Promise<{
  valid: boolean;
  discountType?: string;
  discountValue?: number;
  message?: string;
  minOrderAmount?: number | null;
}> {
  try {
    const res = await fetch(`${BASE_URL}/promotions/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal, email }),
    });
    const data = await res.json();
    if (!res.ok || !data.valid) {
      return { valid: false, message: data.message || 'Code invalide.' };
    }
    return {
      valid: true,
      discountType: data.promotion.type,
      discountValue: Number(data.promotion.value),
      minOrderAmount: data.promotion.minOrderAmount != null ? Number(data.promotion.minOrderAmount) : null,
    };
  } catch {
    return { valid: false, message: 'Erreur de connexion.' };
  }
}

export async function submitOrder(payload: {
  items: { platId: string; quantity: number }[];
  customer: { name: string; phone: string; email?: string; city?: string };
  deliveryMethod: 'pickup' | 'delivery';
  address?: string;
  note?: string;
  promoCode?: string;
}): Promise<{ success: boolean; whatsappUrl?: string; order?: any; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de la commande.' };
    }
    return { success: true, whatsappUrl: data.whatsappUrl, order: data.order };
  } catch (err) {
    return { success: false, error: 'Impossible de joindre le serveur.' };
  }
}

// AUTH
export async function getMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Identifiants invalides.' };
    }
    return { success: true, user: data.user };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function register(name: string, email: string, password: string): Promise<{ 
  success: boolean; 
  requiresVerification?: boolean;
  message?: string;
  devVerificationLink?: string;
  devVerificationCode?: string;
  user?: AuthUser; 
  error?: string 
}> {
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de l’inscription.' };
    }
    return { 
      success: true, 
      requiresVerification: data.requiresVerification,
      message: data.message,
      devVerificationLink: data.devVerificationLink,
      devVerificationCode: data.devVerificationCode,
      user: data.user 
    };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function verifyEmail(token: string): Promise<{
  success: boolean;
  user?: AuthUser;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${BASE_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Lien invalide ou expiré.' };
    }
    return { success: true, user: data.user, message: data.message };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

/** Comme getMe, mais distingue « déconnecté » (ok: true, user: null) d'une panne réseau (ok: false). */
export async function getSession(): Promise<{ ok: boolean; user: AuthUser | null }> {
  try {
    const res = await fetch(`${BASE_URL}/auth/me`, { cache: 'no-store' });
    if (res.status === 401) return { ok: true, user: null };
    if (!res.ok) return { ok: false, user: null };
    const data = await res.json();
    return { ok: true, user: data.user ?? null };
  } catch {
    return { ok: false, user: null };
  }
}

/** Validation de l'inscription avec le code à 6 chiffres reçu par e-mail. */
export async function verifyCode(email: string, code: string, password: string): Promise<{
  success: boolean;
  user?: AuthUser;
  message?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${BASE_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Code incorrect ou expiré.' };
    }
    return { success: true, user: data.user, message: data.message };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/auth/logout`, { method: 'POST' });
  } catch (e) {
    console.error(e);
  }
}

// ADMIN
export async function fetchAdminStats(): Promise<DashboardStats | null> {
  try {
    const res = await fetch(`${BASE_URL}/admin/stats`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchAdminOrders(): Promise<Order[] | null> {
  try {
    const res = await fetch(`${BASE_URL}/admin/orders`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.orders || [];
  } catch {
    return null;
  }
}

export async function updateOrderStatus(orderId: string, status: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createPlat(plat: {
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  isPopular: boolean;
}): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/plats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plat),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deletePlat(platId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/plats/${platId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// PASSWORD RESET & RESEND
export async function requestPasswordReset(email: string): Promise<{ success: boolean; message?: string; devResetLink?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de la demande.' };
    }
    return { success: true, message: data.message, devResetLink: data.devResetLink };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de la réinitialisation.' };
    }
    return { success: true, message: data.message };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function resendVerification(email: string): Promise<{
  success: boolean;
  emailSent?: boolean;
  message?: string;
  devVerificationLink?: string;
  devVerificationCode?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${BASE_URL}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors du renvoi.' };
    }
    return {
      success: true,
      emailSent: data.emailSent,
      message: data.message,
      devVerificationLink: data.devVerificationLink,
      devVerificationCode: data.devVerificationCode,
    };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

// ADMIN PROMOTIONS
export async function fetchAdminPromotions(): Promise<Promotion[]> {
  try {
    const res = await fetch(`${BASE_URL}/admin/promotions`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.promotions || [];
  } catch {
    return [];
  }
}

export async function createAdminPromotion(promo: Partial<Promotion>): Promise<{ success: boolean; promotion?: Promotion; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/admin/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promo),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de la création du code promo.' };
    }
    return { success: true, promotion: data.promotion };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function updateAdminPromotion(id: string, promo: Partial<Promotion>): Promise<{ success: boolean; promotion?: Promotion; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/admin/promotions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promo),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error || 'Erreur lors de la mise à jour.' };
    }
    return { success: true, promotion: data.promotion };
  } catch {
    return { success: false, error: 'Erreur de connexion.' };
  }
}

export async function deleteAdminPromotion(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/admin/promotions/${id}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

