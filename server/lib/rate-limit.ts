import { query } from "./db.js";
import { sha256 } from "./crypto.js";

const WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 8;

// Limiteur en mémoire (fenêtre fixe) pour les routes publiques sans état en base.
// Sur serverless la mémoire est propre à chaque instance : c'est un garde-fou,
// pas une garantie globale — les routes sensibles utilisent la table login_attempts.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export async function tooManyLoginAttempts(restaurantId: string, email: string, ipHash: string | null) {
  const emailHash = sha256(email.trim().toLowerCase());
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM login_attempts
     WHERE restaurant_id = $1 AND email_hash = $2 AND success = FALSE
       AND created_at > now() - ($3::int * interval '1 minute')
       AND ($4::text IS NULL OR ip_hash = $4 OR ip_hash = 'unknown')`,
    [restaurantId, emailHash, WINDOW_MINUTES, ipHash],
  );
  return Number(result.rows[0]?.count ?? 0) >= MAX_FAILED_ATTEMPTS;
}

export async function recordLoginAttempt(restaurantId: string, email: string, ipHash: string | null, success: boolean) {
  await query(
    `INSERT INTO login_attempts (restaurant_id, email_hash, ip_hash, success)
     VALUES ($1, $2, $3, $4)`,
    [restaurantId, sha256(email.trim().toLowerCase()), ipHash ?? "unknown", success],
  );
}
