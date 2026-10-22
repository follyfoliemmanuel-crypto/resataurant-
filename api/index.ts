import type { IncomingMessage, ServerResponse } from "node:http";
import { server } from "../server/index.js";
import { restoreVercelUrl } from "../server/lib/vercel-path.js";

/**
 * Point d'entrée Vercel (route `/api`).
 * `vercel.json` réécrit `/api/(.*)` vers `/api?__savora_path=$1` : on restaure
 * ici le chemin d'origine, puis on relaie la requête Node brute au serveur
 * HTTP maison (même code qu'en local, sans ouvrir de port).
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = restoreVercelUrl(req.url || "/");
  server.emit("request", req, res);
}
