import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2] ?? "SavoraOwner!2026";
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
process.stdout.write(
  `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}\n`,
);
