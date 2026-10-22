import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotEnv(path.join(root, ".env"));

function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const appUrl = (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");

export const config = {
  nodeEnv,
  isProd: nodeEnv === "production",
  appUrl,
  // PORT est fourni par les plateformes d'hébergement (Render, Railway, Fly…).
  apiPort: Number(process.env.PORT ?? process.env.API_PORT ?? 8787),
  databaseUrl: process.env.DATABASE_URL ?? "",
  appSecret: process.env.APP_SECRET ?? "dev-only-change-me-please-use-32-bytes",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:8787/api/auth/google/callback",
  defaultRestaurantSlug: process.env.DEFAULT_RESTAURANT_SLUG ?? "maison-lumen",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "Savora <noreply@localhost>",
  },
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
  sessionCookie: "savora_sid",
  sessionDays: 14,
};

export function requireDatabaseUrl() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is not configured");
}

/**
 * Liste (non bloquante) des variables manquantes ou dangereuses en production.
 * Sert au démarrage (log) et à /api/health, sans empêcher le déploiement.
 */
export function productionConfigIssues() {
  const issues: string[] = [];
  if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
    issues.push("APP_SECRET doit contenir au moins 32 caractères.");
  }
  if (!/^https:\/\//i.test(config.appUrl)) {
    issues.push("APP_URL doit être une URL HTTPS (ex. https://savora.vercel.app).");
  }
  if (!config.databaseUrl) {
    issues.push("DATABASE_URL est absent.");
  }
  if (!config.resendApiKey && !config.smtp.host) {
    issues.push("Aucun service e-mail configuré (RESEND_API_KEY ou SMTP).");
  }
  return config.isProd ? issues : [];
}

export function validateProductionConfig() {
  const issues = productionConfigIssues();
  if (issues.length > 0) throw new Error(issues[0]);
}
