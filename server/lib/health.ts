import { config } from "./config.js";
import { query } from "./db.js";

export type Health = { status: "ok" | "degraded"; db: "ok" | "not_configured" | "error" };

// Endpoint public : aucune donnée sensible, aucun détail d'erreur SQL.
export async function checkHealth(
  deps: { databaseUrl: string; ping: () => Promise<unknown> } = {
    databaseUrl: config.databaseUrl,
    ping: () => query("select 1"),
  },
): Promise<Health> {
  if (!deps.databaseUrl) return { status: "degraded", db: "not_configured" };
  try {
    await deps.ping();
    return { status: "ok", db: "ok" };
  } catch {
    return { status: "degraded", db: "error" };
  }
}
