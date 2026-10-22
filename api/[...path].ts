<<<<<<< HEAD

import type { IncomingMessage, ServerResponse } from "node:http";
import { server } from "../server/index.js";

export default function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
=======
import type { IncomingMessage, ServerResponse } from "node:http";
import { server } from "../server/index.js";

/**
 * Point d'entrée Vercel : la fonction serverless relaie la requête Node brute
 * vers le serveur HTTP maison (même code qu'en local, sans ouvrir de port).
 * Toutes les routes /api/* arrivent ici.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
>>>>>>> d55ed85 (fix: reparer le serveur, securiser les paiements et preparer le deploiement Vercel)
  server.emit("request", req, res);
}
