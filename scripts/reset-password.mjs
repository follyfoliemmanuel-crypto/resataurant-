import pg from 'pg';
import fs from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/DATABASE_URL=(.*)/);
const isLocal = match[1].includes("localhost") || match[1].includes("127.0.0.1");
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
});

await client.connect();

const targetEmail = process.argv[2];
const newPlainPassword = process.argv[3];

if (!targetEmail || !newPlainPassword) {
  console.error("Arguments manquants : identifiant et valeur requis.");
  await client.end();
  process.exit(1);
}

const hashed = hashPassword(newPlainPassword);

const res = await client.query(
  'UPDATE users SET password_hash = $1, email_verified = true, is_active = true WHERE LOWER(email) = LOWER($2) RETURNING id, email, name',
  [hashed, targetEmail]
);

if (res.rows.length > 0) {
  console.log(`Mot de passe réinitialisé avec succès pour: ${res.rows[0].email}`);
  console.log("Mise à jour effectuée avec succès (mot de passe masqué).");
} else {
  console.error(`Utilisateur non trouvé.`);
}

await client.end();
