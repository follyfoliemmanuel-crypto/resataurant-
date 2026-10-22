import http from "node:http";
import { randomInt, createHash } from "node:crypto";
import { config, productionConfigIssues } from "./lib/config.js";
import {
  buildContext,
  requirePermission,
  requireUser,
  publicUser,
  sessionCookieHeader,
  clearSessionCookie,
  assertSameOrigin,
} from "./context.js";
import { query, withTransaction } from "./lib/db.js";
import { HttpError, errorResponse, json, cookie, parseCookies, safeEqual } from "./lib/http.js";
import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  hashIp,
  passwordIssues,
  isEmail,
} from "./lib/crypto.js";
import { checkHealth } from "./lib/health.js";
import {
  computeOrderTotals,
  applyPromotion,
  buildWhatsappMessage,
  whatsappUrl,
} from "./lib/pricing.js";
import { writeAudit, notifyStaff } from "./lib/audit.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "./lib/mail.js";
import { tooManyLoginAttempts, recordLoginAttempt, rateLimit } from "./lib/rate-limit.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1 Mo max body

async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;

    const onData = (chunk: Buffer | string) => {
      size += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      if (size > MAX_BODY_SIZE) {
        cleanup();
        req.destroy();
        reject(new HttpError(413, "Corps de requête trop volumineux (max 1 Mo)."));
        return;
      }
      data += chunk;
    };

    const onEnd = () => {
      cleanup();
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new HttpError(400, "Corps JSON invalide."));
      }
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

function toFetchRequest(req: http.IncomingMessage): Request {
  const host = req.headers.host ?? "localhost";
  const url = `http://${host}${req.url}`;
  const headers = new Headers();

  for (const [key, val] of Object.entries(req.headers)) {
    if (Array.isArray(val)) {
      val.forEach((v) => headers.append(key, v));
    } else if (val !== undefined) {
      headers.set(key, val);
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
  });
}

// Clients connectés au flux temps réel (/api/events) : ils reçoivent un simple signal « ça a changé »
const sseClients = new Set<http.ServerResponse>();
function broadcastChange() {
  const deadClients: http.ServerResponse[] = [];
  for (const client of sseClients) {
    if (client.writableEnded || client.destroyed) {
      deadClients.push(client);
      continue;
    }
    try {
      client.write(`event: change\ndata: ${Date.now()}\n\n`);
    } catch {
      deadClients.push(client);
    }
  }
  for (const dead of deadClients) {
    sseClients.delete(dead);
  }
}

export const server = http.createServer(async (req, res) => {
  const allowedOrigins = new Set([
    config.appUrl,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  const requestOrigin = req.headers.origin;
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cookie",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (req.method === "OPTIONS") {
    res.writeHead(requestOrigin && !allowedOrigins.has(requestOrigin) ? 403 : 204);
    res.end();
    return;
  }

  const rawPath = (req.url || "").split("?")[0];

  // --- HEALTH CHECK (public, sans détail sensible) ---
  if (req.method === "GET" && rawPath === "/api/health") {
    const health = await checkHealth();
    const issues = productionConfigIssues();
    const body = {
      ...health,
      config: issues.length === 0 ? "ok" : "incomplete",
      // Les noms de variables manquantes ne sont utiles qu'en dehors de la prod.
      ...(issues.length > 0 && !config.isProd ? { issues } : {}),
    };
    return sendResponse(
      res,
      json(body, health.status === "ok" && issues.length === 0 ? 200 : 503),
    );
  }

  if (req.method === "GET" && rawPath === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    sseClients.add(res);

    const cleanup = () => {
      clearInterval(ping);
      sseClients.delete(res);
      req.off("close", cleanup);
      res.off("close", cleanup);
      res.off("error", cleanup);
    };

    const ping = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        cleanup();
        return;
      }
      try {
        res.write(": ping\n\n");
      } catch {
        cleanup();
      }
    }, 25_000);

    req.once("close", cleanup);
    res.once("close", cleanup);
    res.once("error", cleanup);
    return;
  }
  // Toute modification réussie (commande, plat, promo, statut...) prévient les écrans ouverts
  if (req.method && !["GET", "HEAD"].includes(req.method)) {
    res.once("finish", () => {
      if (res.statusCode < 400) broadcastChange();
    });
  }

  const fetchReq = toFetchRequest(req);
  const url = new URL(fetchReq.url);
  const pathname = url.pathname;

  try {
    assertSameOrigin(fetchReq);
    const ctx = await buildContext(fetchReq);

    // --- PUBLIC RESTAURANT INFO & SETTINGS ---
    if (req.method === "GET" && pathname === "/api/restaurant") {
      const restRes = await query(
        `SELECT r.id, r.slug, r.plan, s.restaurant_name, s.logo_url, s.description,
                s.phone, s.whatsapp_number, s.email, s.address, s.city, s.currency,
                s.primary_color, s.secondary_color, s.delivery_enabled, s.delivery_fee,
                s.opening_hours, s.features
         FROM restaurants r
         LEFT JOIN restaurant_settings s ON s.restaurant_id = r.id
         WHERE r.id = $1 LIMIT 1`,
        [ctx.restaurantId],
      );

      return sendResponse(res, json({ restaurant: restRes.rows[0] }));
    }

    // --- PUBLIC MENU ---
    if (req.method === "GET" && pathname === "/api/menu") {
      const catsRes = await query(
        `SELECT id, name, description, image_url, position, is_active
         FROM categories
         WHERE restaurant_id = $1 AND is_active = TRUE
         ORDER BY position ASC, created_at ASC`,
        [ctx.restaurantId],
      );

      const platsRes = await query(
        `SELECT p.id, p.category_id, p.name, p.description, p.price, p.image_url,
                p.is_available, p.is_popular, p.position,
                COALESCE(s.quantity, 0) AS stock_quantity
         FROM plats p
         LEFT JOIN stock s ON s.plat_id = p.id
         WHERE p.restaurant_id = $1 AND p.is_available = TRUE
         ORDER BY p.position ASC, p.created_at ASC`,
        [ctx.restaurantId],
      );

      return sendResponse(
        res,
        json({
          categories: catsRes.rows,
          plats: platsRes.rows,
        }),
      );
    }

    // --- PROMOTIONS: CHECK ---
    if (req.method === "POST" && pathname === "/api/promotions/check") {
      const body = await parseBody(req);
      const code = String(body.code ?? "")
        .trim()
        .toUpperCase();
      const clientSubtotal = Number(body.subtotal);
      const clientEmail = body.email ? String(body.email).trim().toLowerCase() : null;

      if (!code) {
        return sendResponse(
          res,
          json({ valid: false, message: "Code promo requis." }, 400),
        );
      }

      // Anti-brute-force : 40 vérifications par minute et par IP.
      if (!rateLimit(`promo:${ctx.restaurantId}:${ctx.ip ?? "unknown"}`, 40, 60_000)) {
        return sendResponse(
          res,
          json(
            { valid: false, message: "Trop de vérifications de code. Réessayez dans une minute." },
            429,
          ),
        );
      }

      const promoRes = await query<{
        id: string;
        name: string;
        code: string;
        type: "percent" | "fixed";
        value: string;
        min_order_amount: string | null;
        max_uses: number | null;
        max_uses_per_user: number | null;
        uses_count: number;
        start_date: string;
        end_date: string;
        is_active: boolean;
      }>(
        `SELECT id, name, code, type, value, min_order_amount, max_uses, max_uses_per_user,
                uses_count, start_date, end_date, is_active
         FROM promotions
         WHERE restaurant_id = $1 AND UPPER(code) = $2
         LIMIT 1`,
        [ctx.restaurantId, code],
      );

      const promo = promoRes.rows[0];

      if (!promo || !promo.is_active) {
        return sendResponse(
          res,
          json(
            { valid: false, message: "Code promo invalide ou désactivé." },
            404,
          ),
        );
      }

      const now = new Date();
      if (new Date(promo.start_date) > now) {
        return sendResponse(
          res,
          json(
            { valid: false, message: "Ce code promo n'est pas encore actif." },
            400,
          ),
        );
      }

      if (new Date(promo.end_date) < now) {
        return sendResponse(
          res,
          json({ valid: false, message: "Ce code promo a expiré." }, 400),
        );
      }

      if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
        return sendResponse(
          res,
          json(
            {
              valid: false,
              message: "Ce code promo a atteint sa limite d'utilisation.",
            },
            400,
          ),
        );
      }

      const minOrder = promo.min_order_amount
        ? Number(promo.min_order_amount)
        : 0;
      if (
        Number.isFinite(clientSubtotal) &&
        clientSubtotal > 0 &&
        minOrder > 0 &&
        clientSubtotal < minOrder
      ) {
        return sendResponse(
          res,
          json(
            {
              valid: false,
              message: `Montant minimum de commande non atteint (minimum : ${minOrder}).`,
            },
            400,
          ),
        );
      }

      if (promo.max_uses_per_user != null && (ctx.user || clientEmail)) {
        const usageCheck = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM promo_usages
           WHERE restaurant_id = $1 AND promotion_id = $2
             AND (($3::uuid IS NOT NULL AND user_id = $3) OR ($4::text IS NOT NULL AND LOWER(client_email) = $4))`,
          [ctx.restaurantId, promo.id, ctx.user?.id ?? null, clientEmail],
        );
        if (Number(usageCheck.rows[0]?.count ?? 0) >= promo.max_uses_per_user) {
          return sendResponse(
            res,
            json(
              {
                valid: false,
                message:
                  "Vous avez déjà atteint la limite d'utilisation pour ce code.",
              },
              400,
            ),
          );
        }
      }

      return sendResponse(
        res,
        json({
          valid: true,
          promotion: {
            id: promo.id,
            name: promo.name,
            code: promo.code,
            type: promo.type,
            value: Number(promo.value),
            minOrderAmount: promo.min_order_amount
              ? Number(promo.min_order_amount)
              : null,
          },
        }),
      );
    }

    // --- CREATE ORDER ---
    if (req.method === "POST" && pathname === "/api/orders") {
      const body = await parseBody(req);
      const { items, customer, deliveryMethod, address, note, promoCode } =
        body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new HttpError(400, "Le panier ne peut pas être vide.");
      }

      if (!customer?.name || !customer?.phone) {
        throw new HttpError(
          400,
          "Le nom et le numéro de téléphone sont obligatoires.",
        );
      }

      const settingsRes = await query(
        `SELECT delivery_enabled, delivery_fee, currency, whatsapp_number
         FROM restaurant_settings WHERE restaurant_id = $1`,
        [ctx.restaurantId],
      );

      const settings = settingsRes.rows[0] || {
        delivery_enabled: true,
        delivery_fee: 0,
        currency: "XOF",
        whatsapp_number: "",
      };

      const platIds = items.map((i: any) => i.platId);
      const dbPlatsRes = await query(
        `SELECT id, name, price FROM plats
         WHERE id = ANY($1) AND restaurant_id = $2 AND is_available = TRUE`,
        [platIds, ctx.restaurantId],
      );

      const dbPlatsMap = new Map(dbPlatsRes.rows.map((p) => [p.id, p]));

      const pricedLines = items.map((item: any) => {
        const p = dbPlatsMap.get(item.platId);

        if (!p) {
          throw new HttpError(
            400,
            "Un plat de votre panier n'est plus disponible. Rechargez la carte.",
          );
        }

        const qty = Math.max(1, Math.min(50, Number(item.quantity) || 1));
        const price = Number(p.price);

        return {
          platId: p.id,
          name: p.name,
          quantity: qty,
          unitPrice: price,
          subtotal: price * qty,
        };
      });

      const rawSubtotal = pricedLines.reduce(
        (acc, l) => acc + l.subtotal,
        0,
      );

      const { order: createdOrder, totals, orderNumber } = await withTransaction(async (client) => {
        // Verrouille et contrôle le stock AVANT toute écriture (anti-survente).
        // Une absence de ligne de stock signifie que le plat n'est pas suivi en stock.
        const neededByPlat = new Map<string, number>();
        for (const line of pricedLines) {
          neededByPlat.set(
            line.platId,
            (neededByPlat.get(line.platId) ?? 0) + line.quantity,
          );
        }
        for (const [platId, needed] of neededByPlat) {
          const stockRes = await client.query<{ quantity: number }>(
            `SELECT quantity FROM stock
             WHERE plat_id = $1 AND restaurant_id = $2
             FOR UPDATE`,
            [platId, ctx.restaurantId],
          );
          const stockRow = stockRes.rows[0];
          if (stockRow && Number(stockRow.quantity) < needed) {
            const name =
              pricedLines.find((l) => l.platId === platId)?.name ?? "ce plat";
            throw new HttpError(400, `Stock insuffisant pour « ${name} ».`);
          }
        }

        let discount = 0;
        let appliedPromoRow: {
          id: string;
          type: "percent" | "fixed";
          value: string;
          min_order_amount: string | null;
          max_uses: number | null;
          max_uses_per_user: number | null;
          uses_count: number;
        } | null = null;

        if (promoCode) {
          const promoLocked = await client.query<{
            id: string;
            type: "percent" | "fixed";
            value: string;
            min_order_amount: string | null;
            max_uses: number | null;
            max_uses_per_user: number | null;
            uses_count: number;
            start_date: string;
            end_date: string;
            is_active: boolean;
          }>(
            `SELECT id, type, value, min_order_amount, max_uses, max_uses_per_user,
                    uses_count, start_date, end_date, is_active
             FROM promotions
             WHERE restaurant_id = $1 AND UPPER(code) = $2
             FOR UPDATE`,
            [ctx.restaurantId, String(promoCode).trim().toUpperCase()],
          );

          const promo = promoLocked.rows[0];
          if (!promo || !promo.is_active) {
            throw new HttpError(400, "Le code promo est invalide ou désactivé.");
          }

          const now = new Date();
          if (new Date(promo.start_date) > now || new Date(promo.end_date) < now) {
            throw new HttpError(400, "Le code promo est expiré.");
          }

          if (promo.max_uses != null && promo.uses_count >= promo.max_uses) {
            throw new HttpError(400, "Ce code promo a atteint sa limite d'utilisation.");
          }

          const minOrder = promo.min_order_amount ? Number(promo.min_order_amount) : 0;
          if (minOrder > 0 && rawSubtotal < minOrder) {
            throw new HttpError(400, `Montant minimum requis de ${minOrder} non atteint pour ce code.`);
          }

          const customerEmail = customer.email ? String(customer.email).trim().toLowerCase() : null;
          if (promo.max_uses_per_user != null && (ctx.user || customerEmail)) {
            const usageCountRes = await client.query<{ count: string }>(
              `SELECT COUNT(*)::text AS count FROM promo_usages
               WHERE restaurant_id = $1 AND promotion_id = $2
                 AND (($3::uuid IS NOT NULL AND user_id = $3) OR ($4::text IS NOT NULL AND LOWER(client_email) = $4))`,
              [ctx.restaurantId, promo.id, ctx.user?.id ?? null, customerEmail],
            );
            if (Number(usageCountRes.rows[0]?.count ?? 0) >= promo.max_uses_per_user) {
              throw new HttpError(400, "Vous avez atteint la limite d'utilisation de ce code promo.");
            }
          }

          appliedPromoRow = promo;
          discount = applyPromotion(rawSubtotal, {
            type: promo.type,
            value: Number(promo.value),
          });
        }

        const totals = computeOrderTotals({
          lines: pricedLines,
          deliveryMethod: deliveryMethod === "delivery" ? "delivery" : "pickup",
          deliveryEnabled: Boolean(settings.delivery_enabled),
          deliveryFee: Number(settings.delivery_fee) || 0,
          discount,
        });

        // Horodatage + aléa : évite les collisions entre deux commandes simultanées.
        const orderNumber = `SAV-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 10000)}`;

        let clientId: string;

        const existingClient = await client.query(
          `SELECT id FROM clients
           WHERE restaurant_id = $1
             AND (phone = $2 OR (email = $3 AND $3 IS NOT NULL))
           LIMIT 1`,
          [ctx.restaurantId, customer.phone, customer.email ?? null],
        );

        if (existingClient.rows.length > 0) {
          clientId = existingClient.rows[0].id;

          await client.query(
            `UPDATE clients
             SET name = $1,
                 address = COALESCE($2, address),
                 city = COALESCE($3, city)
             WHERE id = $4`,
            [customer.name, address ?? null, customer.city ?? null, clientId],
          );
        } else {
          const insertClient = await client.query(
            `INSERT INTO clients
              (restaurant_id, user_id, name, phone, email, address, city)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              ctx.restaurantId,
              ctx.user?.id ?? null,
              customer.name,
              customer.phone,
              customer.email ?? null,
              address ?? null,
              customer.city ?? null,
            ],
          );

          clientId = insertClient.rows[0].id;
        }

        const orderRes = await client.query(
          `INSERT INTO orders (
             restaurant_id, order_number, client_id, subtotal, delivery_fee, discount,
             total, delivery_method, delivery_address, note, promo_code, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
           RETURNING *`,
          [
            ctx.restaurantId,
            orderNumber,
            clientId,
            totals.subtotal,
            totals.deliveryFee,
            totals.discount,
            totals.total,
            deliveryMethod === "delivery" ? "delivery" : "pickup",
            address ?? null,
            note ?? null,
            promoCode ? String(promoCode).trim().toUpperCase() : null,
          ],
        );

        const order = orderRes.rows[0];

        // Incrémenter l'utilisation du code promo et enregistrer dans l'historique
        if (appliedPromoRow) {
          await client.query(
            `UPDATE promotions SET uses_count = uses_count + 1, updated_at = now() WHERE id = $1`,
            [appliedPromoRow.id],
          );
          await client.query(
            `INSERT INTO promo_usages
               (restaurant_id, promotion_id, order_id, user_id, client_email, discount_amount)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              ctx.restaurantId,
              appliedPromoRow.id,
              order.id,
              ctx.user?.id ?? null,
              customer.email ? String(customer.email).trim().toLowerCase() : null,
              discount,
            ],
          );
        }

        for (const line of pricedLines) {
          await client.query(
            `INSERT INTO order_items
              (order_id, plat_id, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              order.id,
              line.platId,
              line.quantity,
              line.unitPrice,
              line.subtotal,
            ],
          );

          await client.query(
            `UPDATE stock
             SET quantity = GREATEST(0, quantity - $1), updated_at = now()
             WHERE plat_id = $2 AND restaurant_id = $3`,
            [line.quantity, line.platId, ctx.restaurantId],
          );
        }

        return { order, totals, orderNumber };
      });

      const whatsappText = buildWhatsappMessage({
        orderNumber,
        customerName: customer.name,
        phone: customer.phone,
        lines: pricedLines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
        })),
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
        method: deliveryMethod,
        address,
        note,
        currency: settings.currency || "XOF",
      });

      const waUrl = settings.whatsapp_number
        ? whatsappUrl(settings.whatsapp_number, whatsappText)
        : null;

      await notifyStaff({
        restaurantId: ctx.restaurantId,
        title: `Nouvelle commande #${orderNumber}`,
        message: `${customer.name} a commandé pour ${totals.total} ${settings.currency || "XOF"}.`,
        type: "order",
      });

      return sendResponse(
        res,
        json(
          {
            success: true,
            order: createdOrder,
            whatsappUrl: waUrl,
            whatsappMessage: whatsappText,
          },
          201,
        ),
      );
    }
    // --- AUTHENTICATION: REGISTER ---
    if (req.method === "POST" && pathname === "/api/auth/register") {
      const body = await parseBody(req);
      const { name, email, password } = body;

      if (!name || !email || !password) {
        throw new HttpError(400, "Nom, email et mot de passe requis.");
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      if (!isEmail(normalizedEmail)) {
        throw new HttpError(400, "Adresse e-mail invalide.");
      }

      const issues = passwordIssues(String(password));
      if (issues.length > 0) {
        throw new HttpError(400, issues[0]);
      }

      const existing = await query<{
        id: string;
        email: string;
        email_verified: boolean;
      }>(
        `SELECT id, email, email_verified FROM users
         WHERE restaurant_id = $1 AND LOWER(email) = LOWER($2)`,
        [ctx.restaurantId, normalizedEmail],
      );

      if (existing.rows.some((u) => u.email_verified)) {
        throw new HttpError(
          409,
          "Un compte existe déjà avec cette adresse e-mail.",
        );
      }

      const pendingUser = existing.rows[0];

      const verificationToken = randomToken(32);
      const tokenHash = sha256(verificationToken);
      const tokenExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);
      const verificationCode = String(randomInt(100000, 1000000));
      const codeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

      const issueTokens = async (
        run: (sql: string, params: unknown[]) => Promise<unknown>,
        userId: string,
      ) => {
        const insertSql = `INSERT INTO email_verification_tokens
          (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`;

        await run(insertSql, [userId, tokenHash, tokenExpiresAt]);
        await run(insertSql, [
          userId,
          sha256(`code:${userId}:${verificationCode}`),
          codeExpiresAt,
        ]);
      };

      let userEmail: string;

      if (pendingUser) {
        userEmail = pendingUser.email;

        const recent = await query(
          `SELECT 1 FROM email_verification_tokens
           WHERE user_id = $1
             AND created_at > now() - interval '30 seconds'
           LIMIT 1`,
          [pendingUser.id],
        );

        if (recent.rows.length > 0) {
          throw new HttpError(
            429,
            "Patientez quelques secondes avant de renvoyer le code.",
          );
        }

        await query(
          `UPDATE email_verification_tokens
           SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [pendingUser.id],
        );

        await issueTokens((sql, params) => query(sql, params), pendingUser.id);
      } else {
        const roleRes = await query<{ id: string }>(
          `SELECT id FROM roles
           WHERE (restaurant_id = $1 OR restaurant_id IS NULL)
             AND name = 'customer'
           ORDER BY restaurant_id NULLS LAST
           LIMIT 1`,
          [ctx.restaurantId],
        );

        let customerRoleId = roleRes.rows[0]?.id;

        if (!customerRoleId) {
          const insRole = await query<{ id: string }>(
            `INSERT INTO roles (restaurant_id, name, permissions)
             VALUES ($1, 'customer', '["account"]'::jsonb)
             ON CONFLICT (restaurant_id, name)
             DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [ctx.restaurantId],
          );

          customerRoleId = insRole.rows[0].id;
        }

        const pwdHash = await hashPassword(password);

        try {
          const created = await withTransaction(async (client) => {
            const insUser = await client.query<{
              id: string;
              email: string;
            }>(
              `INSERT INTO users
                (restaurant_id, email, password_hash, name, role_id,
                 email_verified, is_active)
               VALUES ($1, $2, $3, $4, $5, false, true)
               RETURNING id, email`,
              [
                ctx.restaurantId,
                normalizedEmail,
                pwdHash,
                String(name).trim(),
                customerRoleId,
              ],
            );

            const user = insUser.rows[0];

            await issueTokens(
              (sql, params) => client.query(sql, params),
              user.id,
            );

            return user;
          });

          userEmail = created.email;
        } catch (err) {
          if ((err as { code?: string }).code === "23505") {
            throw new HttpError(
              409,
              "Un compte existe déjà avec cette adresse e-mail.",
            );
          }

          throw err;
        }
      }

      const verificationLink = `${config.appUrl}/?verifyToken=${verificationToken}`;

      let emailSent = false;

      try {
        const mailResult = await sendVerificationEmail(
          userEmail,
          verificationLink,
          verificationCode,
        );
        emailSent = mailResult.sent;
      } catch (mailErr) {
        console.warn("[mail:warning] Impossible d'envoyer l'email:", mailErr);
      }

      const showDevLink = !config.isProd && !emailSent;

      const message = emailSent
        ? `Compte créé ! Entrez le code à 6 chiffres envoyé à ${userEmail} (ou cliquez sur le lien du message). Pensez à vérifier vos spams.`
        : showDevLink
          ? "Compte créé ! L'envoi d'e-mails n'est pas configuré : utilisez le code ou le lien ci-dessous pour confirmer votre adresse."
          : "Compte créé, mais l'e-mail de confirmation n'a pas pu être envoyé. Utilisez « Renvoyer le code » dans quelques secondes.";

      return sendResponse(
        res,
        json(
          {
            success: true,
            requiresVerification: true,
            emailSent,
            message,
            devVerificationLink: showDevLink ? verificationLink : undefined,
            devVerificationCode: showDevLink ? verificationCode : undefined,
          },
          201,
        ),
      );
    }

    // --- AUTHENTICATION: VERIFY EMAIL ---
    if (req.method === "POST" && pathname === "/api/auth/verify") {
      const body = await parseBody(req);
      const token = String(body.token ?? "").trim();
      const code = String(body.code ?? "").trim();

      let tokenRow: { id: string; user_id: string } | undefined;

      if (code) {
        const codeEmail = String(body.email ?? "")
          .trim()
          .toLowerCase();
        const codePassword = String(body.password ?? "");

        if (!codeEmail || !/^\d{6}$/.test(code) || !codePassword) {
          throw new HttpError(
            400,
            "E-mail, mot de passe et code à 6 chiffres requis.",
          );
        }

        const attemptKey = `verify:${codeEmail}`;
        const ipHash = hashIp(ctx.ip) ?? "unknown";

        if (await tooManyLoginAttempts(ctx.restaurantId, attemptKey, null)) {
          throw new HttpError(
            429,
            "Trop de tentatives. Réessayez dans 15 minutes.",
          );
        }

        const pending = await query<{
          id: string;
          password_hash: string | null;
          email_verified: boolean;
        }>(
          `SELECT id, password_hash, email_verified FROM users
           WHERE restaurant_id = $1 AND LOWER(email) = $2
             AND is_active = TRUE
           LIMIT 1`,
          [ctx.restaurantId, codeEmail],
        );

        const candidate = pending.rows[0];

        if (
          candidate &&
          candidate.password_hash &&
          !candidate.email_verified &&
          (await verifyPassword(codePassword, candidate.password_hash))
        ) {
          const codeRes = await query<{ id: string; user_id: string }>(
            `SELECT id, user_id FROM email_verification_tokens
             WHERE user_id = $1 AND token_hash = $2
               AND expires_at > now() AND used_at IS NULL
             LIMIT 1`,
            [candidate.id, sha256(`code:${candidate.id}:${code}`)],
          );

          tokenRow = codeRes.rows[0];
        }

        await recordLoginAttempt(
          ctx.restaurantId,
          attemptKey,
          ipHash,
          Boolean(tokenRow),
        );

        if (!tokenRow) {
          throw new HttpError(400, "Code incorrect ou expiré.");
        }
      } else {
        if (!token) {
          throw new HttpError(400, "Jeton de vérification requis.");
        }

        const tokenRes = await query<{ id: string; user_id: string }>(
          `SELECT id, user_id FROM email_verification_tokens
           WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL
           LIMIT 1`,
          [sha256(token)],
        );

        tokenRow = tokenRes.rows[0];

        if (!tokenRow) {
          throw new HttpError(
            400,
            "Le lien de confirmation est invalide ou a expiré.",
          );
        }
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1`,
          [tokenRow!.id],
        );

        await client.query(
          `UPDATE users SET email_verified = true, updated_at = now()
           WHERE id = $1`,
          [tokenRow!.user_id],
        );
      });

      const userRes = await query<{
        id: string;
        email: string;
        name: string;
        role_name: string;
      }>(
        `SELECT u.id, u.email, u.name, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1 LIMIT 1`,
        [tokenRow.user_id],
      );

      const user = userRes.rows[0];
      const sessionToken = randomToken(32);
      const sessionExpires = new Date(Date.now() + 14 * 86400 * 1000);

      await query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, sha256(sessionToken), sessionExpires],
      );

      const response = json({
        success: true,
        message: "Votre adresse e-mail a été vérifiée avec succès !",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role_name,
        },
      });

      response.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
      return sendResponse(res, response);
    }

    // --- AUTHENTICATION: LOGIN ---
    if (req.method === "POST" && pathname === "/api/auth/login") {
      const body = await parseBody(req);
      const { email, password } = body;

      if (!email || !password) {
        throw new HttpError(400, "Email et mot de passe requis.");
      }

      const loginEmail = String(email).trim().toLowerCase();
      const loginIpHash = hashIp(ctx.ip);
      if (await tooManyLoginAttempts(ctx.restaurantId, loginEmail, loginIpHash)) {
        throw new HttpError(429, "Trop de tentatives de connexion. Réessaie dans 15 minutes.");
      }

      const userRes = await query(
        `SELECT u.*, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.restaurant_id = $1
           AND LOWER(u.email) = LOWER($2)
           AND u.is_active = TRUE
         LIMIT 1`,
        [ctx.restaurantId, loginEmail],
      );

      const user = userRes.rows[0];

      if (!user || !user.password_hash) {
        await recordLoginAttempt(ctx.restaurantId, loginEmail, loginIpHash, false);
        throw new HttpError(401, "Identifiants invalides.");
      }

      const valid = await verifyPassword(password, user.password_hash);

      if (!valid) {
        await recordLoginAttempt(ctx.restaurantId, loginEmail, loginIpHash, false);
        throw new HttpError(401, "Identifiants invalides.");
      }

      await recordLoginAttempt(ctx.restaurantId, loginEmail, loginIpHash, true);

      if (!user.email_verified) {
        throw new HttpError(
          401,
          "Compte non activé. Créez votre compte avec cette adresse pour recevoir un nouveau code de confirmation.",
        );
      }

      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);

      await query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, sha256(token), expiresAt],
      );

      await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [
        user.id,
      ]);

      await writeAudit({
        restaurantId: ctx.restaurantId,
        userId: user.id,
        action: "login",
        entityType: "session",
        entityId: user.id,
        ip: ctx.ip,
      });

      const response = json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role_name,
        },
      });

      response.headers.set("Set-Cookie", sessionCookieHeader(token));
      return sendResponse(res, response);
    }

    // --- AUTHENTICATION: RESEND VERIFICATION EMAIL ---
    if (req.method === "POST" && pathname === "/api/auth/resend-verification") {
      const body = await parseBody(req);
      const email = String(body.email ?? "").trim().toLowerCase();

      if (!email) {
        throw new HttpError(400, "Adresse e-mail requise.");
      }

      const ipHash = hashIp(ctx.ip);
      if (await tooManyLoginAttempts(ctx.restaurantId, `resend:${email}`, ipHash)) {
        throw new HttpError(429, "Trop de demandes. Réessayez dans 15 minutes.");
      }

      const userRes = await query<{ id: string; email: string; email_verified: boolean }>(
        `SELECT id, email, email_verified FROM users
         WHERE restaurant_id = $1 AND LOWER(email) = LOWER($2) AND is_active = TRUE
         LIMIT 1`,
        [ctx.restaurantId, email],
      );

      const user = userRes.rows[0];
      let emailSent = false;
      let verificationLink: string | undefined;
      let verificationCode: string | undefined;

      if (user && !user.email_verified) {
        const recent = await query(
          `SELECT 1 FROM email_verification_tokens
           WHERE user_id = $1 AND created_at > now() - interval '30 seconds'
           LIMIT 1`,
          [user.id],
        );

        if (recent.rows.length > 0) {
          throw new HttpError(429, "Veuillez patienter quelques secondes avant de demander un nouveau code.");
        }

        await query(
          `UPDATE email_verification_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id],
        );

        const token = randomToken(32);
        const tokenHash = sha256(token);
        const tokenExpires = new Date(Date.now() + 24 * 3600 * 1000);
        const code = String(randomInt(100000, 1000000));
        const codeExpires = new Date(Date.now() + 15 * 60 * 1000);

        await query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [user.id, tokenHash, tokenExpires],
        );
        await query(
          `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [user.id, sha256(`code:${user.id}:${code}`), codeExpires],
        );

        verificationLink = `${config.appUrl}/?verifyToken=${token}`;
        verificationCode = code;

        try {
          const mailRes = await sendVerificationEmail(user.email, verificationLink, verificationCode);
          emailSent = mailRes.sent;
        } catch (mailErr) {
          console.warn("[mail:warning] Impossible de renvoyer l'email:", mailErr);
        }
      }

      await recordLoginAttempt(ctx.restaurantId, `resend:${email}`, ipHash, true);

      const showDevLink = !config.isProd && !emailSent && verificationLink;
      return sendResponse(
        res,
        json({
          success: true,
          emailSent,
          message: "Si un compte non vérifié existe avec cette adresse, un nouveau code a été envoyé.",
          devVerificationLink: showDevLink ? verificationLink : undefined,
          devVerificationCode: showDevLink ? verificationCode : undefined,
        }),
      );
    }

    // --- AUTHENTICATION: FORGOT PASSWORD ---
    if (req.method === "POST" && pathname === "/api/auth/forgot-password") {
      const body = await parseBody(req);
      const email = String(body.email ?? "").trim().toLowerCase();

      if (!email) {
        throw new HttpError(400, "Adresse e-mail requise.");
      }

      const ipHash = hashIp(ctx.ip);
      if (await tooManyLoginAttempts(ctx.restaurantId, `forgot:${email}`, ipHash)) {
        throw new HttpError(429, "Trop de tentatives de réinitialisation. Réessayez dans 15 minutes.");
      }

      const userRes = await query<{ id: string; email: string }>(
        `SELECT id, email FROM users
         WHERE restaurant_id = $1 AND LOWER(email) = LOWER($2) AND is_active = TRUE
         LIMIT 1`,
        [ctx.restaurantId, email],
      );

      const user = userRes.rows[0];
      let devResetLink: string | undefined;

      if (user) {
        await query(
          `UPDATE password_reset_tokens SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id],
        );

        const resetToken = randomToken(32);
        const tokenHash = sha256(resetToken);
        const expiresAt = new Date(Date.now() + 3600 * 1000);

        await query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [user.id, tokenHash, expiresAt],
        );

        const resetLink = `${config.appUrl}/?resetToken=${resetToken}`;
        if (!config.isProd) {
          devResetLink = resetLink;
        }

        try {
          await sendPasswordResetEmail(user.email, resetLink);
        } catch (mailErr) {
          console.warn("[mail:warning] Impossible d'envoyer l'email de réinitialisation:", mailErr);
        }
      }

      await recordLoginAttempt(ctx.restaurantId, `forgot:${email}`, ipHash, true);

      return sendResponse(
        res,
        json({
          success: true,
          message: "Si un compte est associé à cette adresse e-mail, un lien de réinitialisation vous a été envoyé.",
          devResetLink,
        }),
      );
    }

    // --- AUTHENTICATION: RESET PASSWORD ---
    if (req.method === "POST" && pathname === "/api/auth/reset-password") {
      const body = await parseBody(req);
      const token = String(body.token ?? "").trim();
      const newPassword = String(body.newPassword ?? "");

      if (!token || !newPassword) {
        throw new HttpError(400, "Jeton et nouveau mot de passe requis.");
      }

      const issues = passwordIssues(newPassword);
      if (issues.length > 0) {
        throw new HttpError(400, issues[0]);
      }

      const ipHash = hashIp(ctx.ip);
      if (await tooManyLoginAttempts(ctx.restaurantId, "reset-password", ipHash)) {
        throw new HttpError(429, "Trop de tentatives. Réessayez dans 15 minutes.");
      }

      const tokenRes = await query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND expires_at > now() AND used_at IS NULL
         LIMIT 1`,
        [sha256(token)],
      );

      const tokenRow = tokenRes.rows[0];
      if (!tokenRow) {
        await recordLoginAttempt(ctx.restaurantId, "reset-password", ipHash, false);
        throw new HttpError(400, "Le lien de réinitialisation est invalide ou a expiré.");
      }

      const newPwdHash = await hashPassword(newPassword);

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
          [tokenRow.id],
        );
        await client.query(
          `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
          [newPwdHash, tokenRow.user_id],
        );
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [tokenRow.user_id]);
      });

      await recordLoginAttempt(ctx.restaurantId, "reset-password", ipHash, true);

      await writeAudit({
        restaurantId: ctx.restaurantId,
        userId: tokenRow.user_id,
        action: "password_reset",
        entityType: "user",
        entityId: tokenRow.user_id,
        ip: ctx.ip,
      });

      return sendResponse(
        res,
        json({
          success: true,
          message: "Votre mot de passe a été modifié avec succès. Vous pouvez maintenant vous connecter.",
        }),
      );
    }

    // --- AUTHENTICATION: GOOGLE OAUTH INITIATE ---
    if (req.method === "GET" && pathname === "/api/auth/google") {
      if (!config.googleClientId || !config.googleClientSecret) {
        throw new HttpError(503, "L'authentification Google n'est pas encore configurée.");
      }

      const state = randomToken(32);
      const codeVerifier = randomToken(48);
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

      const stateCookie = cookie("savora_oauth_state", state, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "Lax",
        maxAge: 600,
        path: "/",
      });

      const verifierCookie = cookie("savora_oauth_verifier", codeVerifier, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "Lax",
        maxAge: 600,
        path: "/",
      });

      const params = new URLSearchParams({
        client_id: config.googleClientId,
        redirect_uri: config.googleRedirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });

      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: googleAuthUrl,
        },
      });
      response.headers.append("Set-Cookie", stateCookie);
      response.headers.append("Set-Cookie", verifierCookie);
      return sendResponse(res, response);
    }

    // --- AUTHENTICATION: GOOGLE OAUTH CALLBACK ---
    if (req.method === "GET" && pathname === "/api/auth/google/callback") {
      const queryMap = Object.fromEntries(url.searchParams);
      const rawCode = typeof queryMap.code === "string" ? queryMap.code : null;
      const rawState = typeof queryMap.state === "string" ? queryMap.state : null;
      const rawError = typeof queryMap.error === "string" ? queryMap.error : null;

      const code = (rawCode && rawCode.length >= 10 && rawCode.length <= 512 && /^[\w./-]+$/.test(rawCode))
        ? rawCode
        : null;

      const state = (rawState && rawState.length >= 20 && rawState.length <= 256 && /^[\w-]+$/.test(rawState))
        ? rawState
        : null;

      const error = (rawError && rawError.length <= 128 && /^[\w _-]+$/.test(rawError))
        ? rawError
        : null;

      const cookies = parseCookies(fetchReq.headers.get("cookie"));
      const savedState = cookies["savora_oauth_state"];
      const savedVerifier = cookies["savora_oauth_verifier"];

      const clearStateCookie = cookie("savora_oauth_state", "", {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "Lax",
        maxAge: 0,
        path: "/",
      });

      const clearVerifierCookie = cookie("savora_oauth_verifier", "", {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "Lax",
        maxAge: 0,
        path: "/",
      });

      const sendOAuthRedirect = (redirectUrl: string) => {
        const redirectRes = new Response(null, {
          status: 302,
          headers: { Location: redirectUrl },
        });
        redirectRes.headers.append("Set-Cookie", clearStateCookie);
        redirectRes.headers.append("Set-Cookie", clearVerifierCookie);
        return sendResponse(res, redirectRes);
      };

      if (error || !code) {
        const errorMsg = encodeURIComponent(error || "Connexion annulée");
        return sendOAuthRedirect(`${config.appUrl}/?authError=${errorMsg}`);
      }

      if (!state || !savedState || state !== savedState) {
        return sendOAuthRedirect(`${config.appUrl}/?authError=session_invalide`);
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: config.googleRedirectUri,
          grant_type: "authorization_code",
          code_verifier: savedVerifier || "",
        }).toString(),
      });

      if (!tokenRes.ok) {
        return sendOAuthRedirect(`${config.appUrl}/?authError=echange_jeton_echoue`);
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string; id_token?: string };
      const accessToken = tokenData.access_token;

      const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!userInfoRes.ok) {
        return sendOAuthRedirect(`${config.appUrl}/?authError=profil_introuvable`);
      }

      const googleUser = (await userInfoRes.json()) as {
        sub: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      };

      const googleId = String(googleUser.sub);
      const googleEmail = String(googleUser.email ?? "").trim().toLowerCase();
      const emailVerified = Boolean(googleUser.email_verified);
      const name = String(googleUser.name ?? googleUser.email ?? "Utilisateur Google").trim();
      const avatarUrl = googleUser.picture ?? null;

      if (!googleId || !googleEmail || !emailVerified) {
        return sendOAuthRedirect(`${config.appUrl}/?authError=email_non_verifie_par_google`);
      }

      let user = (
        await query<{ id: string; email: string; name: string }>(
          `SELECT id, email, name FROM users
           WHERE restaurant_id = $1 AND google_id = $2
           LIMIT 1`,
          [ctx.restaurantId, googleId],
        )
      ).rows[0];

      if (!user) {
        const existingEmailUser = (
          await query<{ id: string; email: string; name: string }>(
            `SELECT id, email, name FROM users
             WHERE restaurant_id = $1 AND LOWER(email) = LOWER($2)
             LIMIT 1`,
            [ctx.restaurantId, googleEmail],
          )
        ).rows[0];

        if (existingEmailUser) {
          await query(
            `UPDATE users
             SET google_id = $1, email_verified = true, avatar_url = COALESCE(avatar_url, $2), updated_at = now()
             WHERE id = $3`,
            [googleId, avatarUrl, existingEmailUser.id],
          );
          user = existingEmailUser;
        } else {
          const roleRes = await query<{ id: string | number }>(
            `SELECT id FROM roles
             WHERE (restaurant_id = $1 OR restaurant_id IS NULL) AND name = 'customer'
             ORDER BY restaurant_id NULLS LAST
             LIMIT 1`,
            [ctx.restaurantId],
          );
          const customerRoleId = roleRes.rows[0]?.id;

          const inserted = await query<{ id: string; email: string; name: string }>(
            `INSERT INTO users (restaurant_id, email, name, avatar_url, role_id, email_verified, google_id, is_active)
             VALUES ($1, $2, $3, $4, $5, true, $6, true)
             RETURNING id, email, name`,
            [ctx.restaurantId, googleEmail, name, avatarUrl, customerRoleId, googleId],
          );
          user = inserted.rows[0];
        }
      }

      const sessionToken = randomToken(32);
      const sessionExpires = new Date(Date.now() + 14 * 86400 * 1000);

      await query(
        `INSERT INTO sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, sha256(sessionToken), sessionExpires],
      );

      await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

      await writeAudit({
        restaurantId: ctx.restaurantId,
        userId: user.id,
        action: "login_google",
        entityType: "session",
        entityId: user.id,
        ip: ctx.ip,
      });

      const redirectRes = new Response(null, {
        status: 302,
        headers: { Location: `${config.appUrl}/?authSuccess=1` },
      });
      redirectRes.headers.set("Set-Cookie", sessionCookieHeader(sessionToken));
      redirectRes.headers.append("Set-Cookie", clearStateCookie);
      redirectRes.headers.append("Set-Cookie", clearVerifierCookie);
      return sendResponse(res, redirectRes);
    }

    // --- AUTHENTICATION: LOGOUT ---
    if (req.method === "POST" && pathname === "/api/auth/logout") {
      if (ctx.user) {
        await query(`DELETE FROM sessions WHERE id = $1`, [ctx.user.sessionId]);
      }

      const response = json({ success: true });
      response.headers.set("Set-Cookie", clearSessionCookie());
      return sendResponse(res, response);
    }

    // --- AUTHENTICATION: ME ---
    if (req.method === "GET" && pathname === "/api/auth/me") {
      if (!ctx.user) {
        return sendResponse(res, json({ user: null }));
      }

      return sendResponse(res, json({ user: publicUser(ctx.user) }));
    }

    // --- ADMIN DASHBOARD STATS ---
    if (req.method === "GET" && pathname === "/api/admin/stats") {
      requirePermission(ctx, "statistics");

      const safe = async <T>(
        label: string,
        fn: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await fn();
        } catch (err) {
          console.error(`[stats:${label}]`, err);
          return fallback;
        }
      };

      const summary = await safe(
        "summary",
        async () =>
          (
            await query(
              `SELECT COUNT(*) AS total_orders,
                      COALESCE(SUM(total), 0) AS total_revenue,
                      COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
                      COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_orders
               FROM orders WHERE restaurant_id = $1`,
              [ctx.restaurantId],
            )
          ).rows[0],
        {
          total_orders: "0",
          total_revenue: "0",
          pending_orders: "0",
          delivered_orders: "0",
        },
      );

      const recentOrders = await safe(
        "recent",
        async () =>
          (
            await query(
              `SELECT o.id, o.order_number, o.total, o.status,
                      o.delivery_method, o.created_at,
                      c.name AS client_name, c.phone AS client_phone
               FROM orders o
               LEFT JOIN clients c ON c.id = o.client_id
               WHERE o.restaurant_id = $1
               ORDER BY o.created_at DESC LIMIT 10`,
              [ctx.restaurantId],
            )
          ).rows,
        [] as any[],
      );

      const popularPlats = await safe(
        "popular",
        async () =>
          (
            await query(
              `SELECT p.name, SUM(oi.quantity) AS total_sold,
                      SUM(oi.subtotal) AS total_revenue
               FROM order_items oi
               JOIN plats p ON p.id = oi.plat_id
               WHERE p.restaurant_id = $1
               GROUP BY p.name
               ORDER BY total_sold DESC LIMIT 5`,
              [ctx.restaurantId],
            )
          ).rows,
        [] as any[],
      );

      return sendResponse(res, json({ summary, recentOrders, popularPlats }));
    }

    // --- ADMIN: ORDERS LIST ---
    if (req.method === "GET" && pathname === "/api/admin/orders") {
      requirePermission(ctx, "orders");

      const ordersRes = await query(
        `SELECT o.*, c.name AS client_name,
                c.phone AS client_phone, c.address AS client_address
         FROM orders o
         LEFT JOIN clients c ON c.id = o.client_id
         WHERE o.restaurant_id = $1
         ORDER BY o.created_at DESC`,
        [ctx.restaurantId],
      );

      return sendResponse(res, json({ orders: ordersRes.rows }));
    }

    // --- ADMIN: UPDATE ORDER STATUS ---
    if (req.method === "PATCH" && pathname.startsWith("/api/admin/orders/")) {
      requirePermission(ctx, "orders");

      const orderId = pathname.split("/").pop();
      const body = await parseBody(req);
      const { status } = body;

      const validStatuses = [
        "pending",
        "confirmed",
        "preparing",
        "ready",
        "delivering",
        "delivered",
        "cancelled",
      ];

      if (!validStatuses.includes(status)) {
        throw new HttpError(400, "Statut de commande invalide.");
      }

      await query(
        `UPDATE orders SET status = $1, updated_at = now()
         WHERE id = $2 AND restaurant_id = $3`,
        [status, orderId, ctx.restaurantId],
      );

      return sendResponse(res, json({ success: true, status }));
    }

    // --- ADMIN: CREATE DISH ---
    if (req.method === "POST" && pathname === "/api/admin/plats") {
      requirePermission(ctx, "products");

      const body = await parseBody(req);
      const {
        categoryId,
        name,
        description,
        price,
        imageUrl,
        isAvailable,
        isPopular,
      } = body;

      const ins = await query(
        `INSERT INTO plats
          (restaurant_id, category_id, name, description, price,
           image_url, is_available, is_popular)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          ctx.restaurantId,
          categoryId,
          name,
          description,
          price,
          imageUrl ?? null,
          isAvailable ?? true,
          isPopular ?? false,
        ],
      );

      return sendResponse(res, json({ plat: ins.rows[0] }, 201));
    }

    // --- ADMIN: DELETE DISH ---
    if (req.method === "DELETE" && pathname.startsWith("/api/admin/plats/")) {
      requirePermission(ctx, "products");

      const platId = pathname.split("/").pop();

      await query(`DELETE FROM plats WHERE id = $1 AND restaurant_id = $2`, [
        platId,
        ctx.restaurantId,
      ]);

      return sendResponse(res, json({ success: true }));
    }

    // --- ADMIN: LIST PROMOTIONS ---
    if (req.method === "GET" && pathname === "/api/admin/promotions") {
      requirePermission(ctx, "promotions");

      const promosRes = await query(
        `SELECT * FROM promotions
         WHERE restaurant_id = $1
         ORDER BY created_at DESC`,
        [ctx.restaurantId],
      );

      return sendResponse(res, json({ promotions: promosRes.rows }));
    }

    // --- ADMIN: CREATE PROMOTION ---
    if (req.method === "POST" && pathname === "/api/admin/promotions") {
      requirePermission(ctx, "promotions");
      const body = await parseBody(req);

      const code = String(body.code ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      const type = body.type === "fixed" ? "fixed" : "percent";
      const value = Number(body.value);
      const minOrderAmount =
        body.min_order_amount != null && body.min_order_amount !== ""
          ? Number(body.min_order_amount)
          : null;
      const maxUses =
        body.max_uses != null && body.max_uses !== ""
          ? parseInt(String(body.max_uses), 10)
          : null;
      const maxUsesPerUser =
        body.max_uses_per_user != null && body.max_uses_per_user !== ""
          ? parseInt(String(body.max_uses_per_user), 10)
          : null;
      const startDate = body.start_date
        ? new Date(body.start_date)
        : new Date();
      const endDate = body.end_date
        ? new Date(body.end_date)
        : new Date(Date.now() + 365 * 86400 * 1000);
      const isActive = body.is_active !== false;

      if (!code || code.length < 2) {
        throw new HttpError(
          400,
          "Le code promo doit comporter au moins 2 caractères.",
        );
      }
      if (!name) {
        throw new HttpError(400, "Le nom du code promo est obligatoire.");
      }
      if (!Number.isFinite(value) || value <= 0) {
        throw new HttpError(400, "La réduction doit être supérieure à 0.");
      }
      if (type === "percent" && value > 100) {
        throw new HttpError(
          400,
          "Le pourcentage de réduction ne peut pas dépasser 100%.",
        );
      }
      if (
        minOrderAmount != null &&
        (!Number.isFinite(minOrderAmount) || minOrderAmount < 0)
      ) {
        throw new HttpError(
          400,
          "Le montant minimum de commande est invalide.",
        );
      }
      if (maxUses != null && (isNaN(maxUses) || maxUses <= 0)) {
        throw new HttpError(
          400,
          "Le nombre maximal d'utilisations doit être un entier positif.",
        );
      }
      if (
        maxUsesPerUser != null &&
        (isNaN(maxUsesPerUser) || maxUsesPerUser <= 0)
      ) {
        throw new HttpError(
          400,
          "La limite par utilisateur doit être un entier positif.",
        );
      }

      try {
        const ins = await query(
          `INSERT INTO promotions (
             restaurant_id, code, name, type, value, min_order_amount,
             max_uses, max_uses_per_user, start_date, end_date, is_active
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            ctx.restaurantId,
            code,
            name,
            type,
            value,
            minOrderAmount,
            maxUses,
            maxUsesPerUser,
            startDate,
            endDate,
            isActive,
          ],
        );

        await writeAudit({
          restaurantId: ctx.restaurantId,
          userId: ctx.user!.id,
          action: "create_promotion",
          entityType: "promotion",
          entityId: ins.rows[0].id,
          ip: ctx.ip,
        });

        return sendResponse(
          res,
          json({ success: true, promotion: ins.rows[0] }, 201),
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new HttpError(409, `Le code promo "${code}" existe déjà.`);
        }
        throw err;
      }
    }

    // --- ADMIN: UPDATE PROMOTION ---
    if (
      (req.method === "PUT" || req.method === "PATCH") &&
      pathname.startsWith("/api/admin/promotions/")
    ) {
      requirePermission(ctx, "promotions");
      const promoId = pathname.split("/").pop();
      const body = await parseBody(req);

      const existingRes = await query<{ id: string }>(
        `SELECT id FROM promotions WHERE id = $1 AND restaurant_id = $2`,
        [promoId, ctx.restaurantId],
      );
      if (existingRes.rows.length === 0) {
        throw new HttpError(404, "Code promo introuvable.");
      }

      const code =
        body.code != null ? String(body.code).trim().toUpperCase() : undefined;
      const name = body.name != null ? String(body.name).trim() : undefined;
      const type =
        body.type === "fixed" || body.type === "percent"
          ? body.type
          : undefined;
      const value = body.value != null ? Number(body.value) : undefined;
      const minOrderAmount =
        body.min_order_amount !== undefined
          ? body.min_order_amount === null || body.min_order_amount === ""
            ? null
            : Number(body.min_order_amount)
          : undefined;
      const maxUses =
        body.max_uses !== undefined
          ? body.max_uses === null || body.max_uses === ""
            ? null
            : parseInt(String(body.max_uses), 10)
          : undefined;
      const maxUsesPerUser =
        body.max_uses_per_user !== undefined
          ? body.max_uses_per_user === null || body.max_uses_per_user === ""
            ? null
            : parseInt(String(body.max_uses_per_user), 10)
          : undefined;
      const startDate = body.start_date ? new Date(body.start_date) : undefined;
      const endDate = body.end_date ? new Date(body.end_date) : undefined;
      const isActive =
        body.is_active !== undefined ? Boolean(body.is_active) : undefined;

      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
        throw new HttpError(400, "La valeur de réduction doit être positive.");
      }
      if (type === "percent" && value !== undefined && value > 100) {
        throw new HttpError(
          400,
          "Le pourcentage de réduction ne peut pas dépasser 100%.",
        );
      }

      const updated = await query(
        `UPDATE promotions SET
           code = COALESCE($1, code),
           name = COALESCE($2, name),
           type = COALESCE($3, type),
           value = COALESCE($4, value),
           min_order_amount = CASE WHEN $5::boolean THEN $6 ELSE min_order_amount END,
           max_uses = CASE WHEN $7::boolean THEN $8 ELSE max_uses END,
           max_uses_per_user = CASE WHEN $9::boolean THEN $10 ELSE max_uses_per_user END,
           start_date = COALESCE($11, start_date),
           end_date = COALESCE($12, end_date),
           is_active = COALESCE($13, is_active),
           updated_at = now()
         WHERE id = $14 AND restaurant_id = $15
         RETURNING *`,
        [
          code ?? null,
          name ?? null,
          type ?? null,
          value ?? null,
          minOrderAmount !== undefined,
          minOrderAmount ?? null,
          maxUses !== undefined,
          maxUses ?? null,
          maxUsesPerUser !== undefined,
          maxUsesPerUser ?? null,
          startDate ?? null,
          endDate ?? null,
          isActive ?? null,
          promoId,
          ctx.restaurantId,
        ],
      );

      await writeAudit({
        restaurantId: ctx.restaurantId,
        userId: ctx.user!.id,
        action: "update_promotion",
        entityType: "promotion",
        entityId: promoId!,
        ip: ctx.ip,
      });

      return sendResponse(
        res,
        json({ success: true, promotion: updated.rows[0] }),
      );
    }

    // --- ADMIN: DELETE PROMOTION ---
    if (
      req.method === "DELETE" &&
      pathname.startsWith("/api/admin/promotions/")
    ) {
      requirePermission(ctx, "promotions");
      const promoId = pathname.split("/").pop();

      const del = await query(
        `DELETE FROM promotions WHERE id = $1 AND restaurant_id = $2 RETURNING id`,
        [promoId, ctx.restaurantId],
      );

      if (del.rows.length === 0) {
        throw new HttpError(404, "Code promo introuvable.");
      }

      await writeAudit({
        restaurantId: ctx.restaurantId,
        userId: ctx.user!.id,
        action: "delete_promotion",
        entityType: "promotion",
        entityId: promoId!,
        ip: ctx.ip,
      });

      return sendResponse(res, json({ success: true }));
    }

    // --- PAYGATE: INITIATE PAYMENT ---
    if (req.method === "POST" && pathname === "/api/payments/initiate") {
      // Paiement en ligne réservé au client propriétaire de la commande ou au staff.
      const user = requireUser(ctx);
      const body = await parseBody(req);
      const orderId = String(body.orderId ?? "").trim();
      const phoneNumber = String(body.phoneNumber ?? "").trim();
      const method = String(body.method ?? "").toLowerCase().trim();

      if (!orderId || !phoneNumber) {
        throw new HttpError(400, "Commande et numéro de téléphone obligatoires.");
      }

      if (!["flooz", "tmoney"].includes(method)) {
        throw new HttpError(400, "Méthode de paiement invalide (choisissez Flooz ou T-Money).");
      }

      if (!/^\+?[0-9\s-]{8,20}$/.test(phoneNumber)) {
        throw new HttpError(400, "Numéro de téléphone invalide.");
      }

      const orderRes = await query<{
        id: string;
        total: string;
        status: string;
        client_user_id: string | null;
      }>(
        `SELECT o.id, o.total, o.status, c.user_id AS client_user_id
         FROM orders o
         JOIN clients c ON c.id = o.client_id
         WHERE o.id = $1 AND o.restaurant_id = $2
         LIMIT 1`,
        [orderId, ctx.restaurantId],
      );

      const order = orderRes.rows[0];
      if (!order) {
        throw new HttpError(404, "Commande introuvable.");
      }

      const isOwner = order.client_user_id === user.id;
      const isStaff = user.role !== "customer";
      if (!isOwner && !isStaff) {
        throw new HttpError(403, "Cette commande ne vous appartient pas.", "forbidden");
      }

      if (order.status === "cancelled") {
        throw new HttpError(400, "Cette commande a été annulée.");
      }

      const amount = Number(order.total);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new HttpError(400, "Montant de commande invalide.");
      }

      const paymentRes = await query<{ id: string }>(
        `INSERT INTO payments (order_id, payment_method, amount, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [order.id, method, amount],
      );

      const paymentId = paymentRes.rows[0].id;
      const token = process.env.PAYGATE_API_TOKEN;

      if (!token) {
        // En mode dev sans token PayGate configuré, renvoyer une confirmation de test sécurisée
        if (!config.isProd) {
          return sendResponse(
            res,
            json(
              {
                success: true,
                paymentId,
                status: "pending",
                message: "Paiement initié en mode développement (jeton PayGate non configuré).",
              },
              201,
            ),
          );
        }
        throw new HttpError(503, "Le service de paiement PayGate n'est pas encore configuré.");
      }

      let gatewayResponse: Response;
      try {
        gatewayResponse = await fetch("https://paygateglobal.com/api/v1/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            auth_token: token,
            phone_number: phoneNumber.replace(/[\s-]/g, ""),
            amount,
            identifier: paymentId,
            description: `Commande Savora #${order.id.slice(0, 8)}`,
            network: method === "flooz" ? "FLOOZ" : "TMONEY",
          }),
          signal: AbortSignal.timeout(15000),
        });
      } catch (err) {
        console.error(
          "[PayGate] Erreur réseau lors de l'initiation :",
          err instanceof Error ? err.message : "Erreur de connexion",
        );
        throw new HttpError(
          502,
          `Résultat de demande incertain. Vérifiez le paiement ${paymentId} avant de réessayer.`,
        );
      }

      const gatewayText = await gatewayResponse.text();
      let gateway: { tx_reference?: string; status?: number | string; message?: string };
      try {
        gateway = JSON.parse(gatewayText);
      } catch {
        gateway = { status: -1 };
      }

      if (!gatewayResponse.ok || Number(gateway.status) !== 0) {
        await query(
          `UPDATE payments SET status = 'failed', updated_at = now()
           WHERE id = $1 AND status = 'pending'`,
          [paymentId],
        );
        throw new HttpError(502, "PayGate a refusé la demande de paiement.");
      }

      await query(
        `UPDATE payments SET provider_reference = $1, status = 'processing', updated_at = now()
         WHERE id = $2`,
        [gateway.tx_reference ?? null, paymentId],
      );

      return sendResponse(
        res,
        json(
          {
            success: true,
            paymentId,
            status: "processing",
            message: "Demande envoyée. Le paiement est en attente de confirmation sur le téléphone.",
          },
          201,
        ),
      );
    }

    // --- PAYGATE: PAYMENT STATUS UPDATE / WEBHOOK ---
    if (req.method === "POST" && pathname === "/api/payments/status") {
      const body = await parseBody(req);
      const paymentId = String(body.paymentId ?? "").trim();
      const status = String(body.status ?? "").toLowerCase().trim();
      const txReference = body.txReference ? String(body.txReference).trim() : null;

      if (!paymentId || !status) {
        throw new HttpError(400, "Identifiant de paiement et statut obligatoires.");
      }

      const validStatuses = ["pending", "processing", "paid", "failed", "cancelled"];
      if (!validStatuses.includes(status)) {
        throw new HttpError(400, "Statut de paiement invalide.");
      }

      // Webhook PayGate (jeton partagé) OU membre du staff authentifié.
      // Sans l'un des deux, n'importe qui pourrait marquer une commande « payée ».
      const providerToken = process.env.PAYGATE_API_TOKEN ?? "";
      const headerToken = String(req.headers["x-paygate-token"] ?? "");
      const providedToken = String(
        body.auth_token ?? body.token ?? headerToken ?? "",
      );
      const fromProvider =
        providerToken.length > 0 && safeEqual(providedToken, providerToken);
      const isStaffUser = Boolean(ctx.user && ctx.user.role !== "customer");
      if (!fromProvider && !isStaffUser) {
        throw new HttpError(403, "Requête de paiement non autorisée.", "forbidden");
      }

      await withTransaction(async (client) => {
        const locked = await client.query<{ id: string; order_id: string; status: string }>(
          `SELECT id, order_id, status FROM payments WHERE id = $1 FOR UPDATE`,
          [paymentId],
        );
        const current = locked.rows[0];
        if (!current) {
          throw new HttpError(404, "Paiement introuvable.");
        }

        // Ne jamais rétrograder un paiement déjà validé
        const finalStatus = current.status === "paid" ? "paid" : status;
        await client.query(
          `UPDATE payments SET status = $1, provider_reference = COALESCE($2, provider_reference), updated_at = now()
           WHERE id = $3`,
          [finalStatus, txReference, paymentId],
        );

        if (finalStatus === "paid") {
          await client.query(
            `UPDATE orders SET status = 'confirmed', updated_at = now()
             WHERE id = $1 AND restaurant_id = $2 AND status = 'pending'`,
            [current.order_id, ctx.restaurantId],
          );
        }
      });

      return sendResponse(res, json({ success: true, paymentId, status }));
    }

    // --- FALLBACK 404 ---
    return sendResponse(
      res,
      json({ error: "Route API non trouvée.", path: pathname }, 404),
    );
  } catch (err) {
    return sendResponse(res, errorResponse(err));
  }
});

function sendResponse(res: http.ServerResponse, fetchRes: Response) {
  res.statusCode = fetchRes.status;

  fetchRes.headers.forEach((val, key) => {
    // Les cookies doivent être transmis un par un : fusionner plusieurs
    // en-têtes Set-Cookie dans une seule ligne fait perdre des cookies.
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, val);
  });

  const setCookies =
    typeof fetchRes.headers.getSetCookie === "function"
      ? fetchRes.headers.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    res.setHeader("Set-Cookie", setCookies);
  }

  fetchRes.text().then((text) => res.end(text));
}


const port = config.apiPort || 8787;

// Sur Vercel (fonction serverless) on n'ouvre JAMAIS de port : la fonction
// reçoit les requêtes via `server.emit("request", ...)` dans api/[...path].ts.
const isServerless = Boolean(process.env.VERCEL);

if (config.isProd) {
  const issues = productionConfigIssues();
  if (issues.length > 0) {
    console.error(
      `[savora-api] Configuration de production incomplète :\n - ${issues.join("\n - ")}`,
    );
  }
}

if (process.env.NODE_ENV !== "test" && !isServerless) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`[savora-api] Server running on http://localhost:${port}`);
  });
}
