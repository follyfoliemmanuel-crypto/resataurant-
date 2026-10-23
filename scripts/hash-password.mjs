import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2] ?? process.env.SAVORA_PASSWORD;

if (!password) {
  console.error("Usage : fournir la valeur à hacher en argument ou via une variable d'environnement.");
  process.exit(1);
}

if (
  password.length < 12 ||
  !/[a-z]/.test(password) ||
  !/[A-Z]/.test(password) ||
  !/[0-9]/.test(password)
) {
  console.error(
    "La valeur doit contenir au moins 12 caractères, avec majuscule, minuscule et chiffre.",
  );
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
process.stdout.write(
  `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}\n`,
);
