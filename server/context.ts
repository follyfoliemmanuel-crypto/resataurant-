import { config } from "./lib/config.js";
import { query } from "./lib/db.js";
import { hashIp, sha256 } from "./lib/crypto.js";
import { cookie, HttpError, parseCookies } from "./lib/http.js";
import { can, getRestaurantBySlug, type Plan, type RoleName } from "./lib/permissions.js";

export type AuthUser = {
  id: string;
  restaurantId: string;
  email: string;
  name: string;
  role: RoleName;
  emailVerified: boolean;
  totpEnabled: boolean;
  sessionId: string;
};

export type AppContext = {
  req: Request;
  url: URL;
  ip: string | null;
  restaurantId: string;
  plan: Plan;
  user: AuthUser | null;
};

export async function buildContext(req: Request): Promise<AppContext> {
  const url = new URL(req.url);
  const ip = clientIp(req);
  const restaurant = await getRestaurantBySlug(config.defaultRestaurantSlug);
  if (!restaurant || !restaurant.is_active) {
    throw new HttpError(503, "Restaurant indisponible.", "restaurant_unavailable");
  }
  const user = await loadSession(req, restaurant.id);
  return { req, url, ip, restaurantId: restaurant.id, plan: restaurant.plan, user };
}

export function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export async function loadSession(req: Request, restaurantId: string): Promise<AuthUser | null> {
  const token = parseCookies(req.headers.get("cookie"))[config.sessionCookie];
  if (!token) return null;
  const result = await query<{
    session_id: string;
    user_id: string;
    email: string;
    name: string;
    email_verified: boolean;
    totp_enabled: boolean;
    role: RoleName;
    restaurant_id: string;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email, u.name, u.email_verified, u.totp_enabled,
            r.name AS role, u.restaurant_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = TRUE AND u.restaurant_id = $2
     LIMIT 1`,
    [sha256(token), restaurantId],
  );
  const row = result.rows[0];
  if (!row) return null;
  await query("UPDATE sessions SET last_used_at = now() WHERE id = $1", [row.session_id]);
  return {
    id: row.user_id,
    restaurantId: row.restaurant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.email_verified,
    totpEnabled: row.totp_enabled,
    sessionId: row.session_id,
  };
}

export function requireUser(ctx: AppContext) {
  if (!ctx.user) throw new HttpError(401, "Authentification requise.", "unauthenticated");
  if (!ctx.user.emailVerified) {
    throw new HttpError(403, "Confirmez votre adresse e-mail pour continuer.", "email_unverified");
  }
  return ctx.user;
}

export function requirePermission(ctx: AppContext, permission: string) {
  const user = requireUser(ctx);
  if (!can(user.role, permission)) {
    throw new HttpError(403, "Accès refusé.", "forbidden");
  }
  return user;
}

export function sessionCookieHeader(token: string, maxAge = config.sessionDays * 86400) {
  return cookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "Lax",
    maxAge,
    path: "/",
  });
}

export function clearSessionCookie() {
  return cookie(config.sessionCookie, "", {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "Lax",
    maxAge: 0,
    path: "/",
  });
}

export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  const app = new URL(config.appUrl);
  if (origin) {
    const incoming = new URL(origin);
    if (incoming.host !== app.host && incoming.hostname !== "localhost" && incoming.hostname !== "127.0.0.1") {
      throw new HttpError(403, "Origine non autorisée.", "csrf");
    }
  }
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    totpEnabled: user.totpEnabled,
  };
}

export { hashIp };
