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
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const targetEmail = process.argv[2] || 'foloyfoiliemmanuel@gmail.com';
const newPlainPassword = process.argv[3] || 'SavoraOwner!2026';
const hashed = hashPassword(newPlainPassword);

const res = await client.query(
  'UPDATE users SET password_hash = $1, email_verified = true, is_active = true WHERE LOWER(email) = LOWER($2) RETURNING id, email, name',
  [hashed, targetEmail]
);

if (res.rows.length > 0) {
  console.log(`Mot de passe réinitialisé avec succès pour: ${res.rows[0].email}`);
  console.log(`Nouveau mot de passe: ${newPlainPassword}`);
} else {
  console.error(`Utilisateur ${targetEmail} non trouvé.`);
}

await client.end();
