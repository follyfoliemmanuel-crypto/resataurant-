import type pg from "pg";
import { query } from "./db.js";
import { hashIp } from "./crypto.js";

export async function writeAudit(args: { restaurantId: string; userId?: string | null; action: string; entityType: string; entityId?: string | null; metadata?: Record<string, unknown>; ip?: string | null }, client?: pg.PoolClient) {
  const sql = `INSERT INTO audit_logs (restaurant_id, user_id, action, entity_type, entity_id, metadata, ip_hash)
               VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`;
  const params = [args.restaurantId, args.userId ?? null, args.action, args.entityType, args.entityId ?? null, JSON.stringify(args.metadata ?? {}), hashIp(args.ip ?? null)];
  if (client) await client.query(sql, params);
  else await query(sql, params);
}

export async function notifyStaff(args: { restaurantId: string; title: string; message: string; type: "order" | "stock" | "user" | "system" | "promo" }) {
  await query(
    `INSERT INTO notifications (restaurant_id, user_id, title, message, type)
     SELECT $1, u.id, $2, $3, $4
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.restaurant_id = $1 AND r.name IN ('owner','admin','manager') AND u.is_active = TRUE`,
    [args.restaurantId, args.title, args.message, args.type],
  );
}
