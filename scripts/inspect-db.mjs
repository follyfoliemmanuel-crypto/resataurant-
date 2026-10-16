import fs from "node:fs";
import pg from "pg";

const env = fs.readFileSync(".env", "utf8");
const dbUrl = env.match(/^DATABASE_URL=(.*)$/m)[1].trim();
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: true },
});

await client.connect();
const tables = ["users", "roles", "promotions", "orders", "payments", "email_verification_tokens", "password_reset_tokens", "sessions", "login_attempts"];
for (const table of tables) {
  const res = await client.query(
    "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
    [table]
  );
  console.log(`\n--- TABLE ${table} ---`);
  console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(", "));
}
await client.end();
