import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(root, ".env"));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: true },
});

await client.connect();
const sql = fs.readFileSync(path.join(root, "database", "seed", "demo.sql"), "utf8");
await client.query(sql);

const restaurantId = "00000000-0000-4000-8000-000000000001";
const ownerHash = hashPassword("SavoraOwner!2026");
const clientHash = hashPassword("SavoraClient!2026");

await client.query(
  `INSERT INTO users (id, restaurant_id, email, password_hash, name, role_id, email_verified, is_active)
   VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
   ON CONFLICT (restaurant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verified = TRUE`,
  [
    "00000000-0000-4000-8000-000000000101",
    restaurantId,
    "owner@maison-lumen.example",
    ownerHash,
    "Camille Lumen",
    "00000000-0000-4000-8000-000000000011",
  ],
);

await client.query(
  `INSERT INTO users (id, restaurant_id, email, password_hash, name, role_id, email_verified, is_active)
   VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
   ON CONFLICT (restaurant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash, email_verified = TRUE`,
  [
    "00000000-0000-4000-8000-000000000102",
    restaurantId,
    "client@maison-lumen.example",
    clientHash,
    "Léa Martin",
    "00000000-0000-4000-8000-000000000016",
  ],
);

await client.query(
  `INSERT INTO clients (restaurant_id, user_id, name, phone, email, address, city)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT DO NOTHING`,
  [
    restaurantId,
    "00000000-0000-4000-8000-000000000102",
    "Léa Martin",
    "0612345678",
    "client@maison-lumen.example",
    "12 rue de la Fontaine",
    "Paris",
  ],
);

await client.end();
console.log("seed complete");
console.log("owner: owner@maison-lumen.example / SavoraOwner!2026");
console.log("client: client@maison-lumen.example / SavoraClient!2026");

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
