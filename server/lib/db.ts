import pg from "pg";
import { config, requireDatabaseUrl } from "./config.js";

let pool: pg.Pool | null = null;

export function getPool() {
  requireDatabaseUrl();
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 8,
      ssl: config.databaseUrl.includes("localhost") || config.databaseUrl.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: true },
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
