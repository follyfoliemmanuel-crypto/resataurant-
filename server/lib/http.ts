import { timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  public status: number;
  public code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  const message = error instanceof Error ? error.message : "internal_error";
  if (message.includes("DATABASE_URL") || message.includes("not configured")) {
    return json({ error: "Service indisponible.", code: "unavailable" }, 503);
  }
  console.error("[savora]", error instanceof Error ? error.message : error);
  return json({ error: "Une erreur est survenue.", code: "internal" }, 500);
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCookies(header: string | null) {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const rawValue = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookie values rather than failing the whole request.
    }
  }
  return out;
}

export function cookie(name: string, value: string, options: {
  maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None"; path?: string;
}) {
  const safeName = name.replace(/[;=\s]/g, "");
  const safeValue = encodeURIComponent(value);
  const parts = [`${safeName}=${safeValue}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}
