/**
 * Vercel ne route que le premier segment d'un catch-all `api/[...path].ts`.
 * On réécrit donc `/api/*` vers `/api` (api/index.ts) en plaçant le chemin
 * réel dans ce paramètre, puis on restaure l'URL d'origine avant de la
 * confier au serveur HTTP maison.
 */
export const VERCEL_PATH_PARAM = "__savora_path";

export function restoreVercelUrl(rawUrl: string): string {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex === -1) return rawUrl;

  const search = new URLSearchParams(rawUrl.slice(queryIndex + 1));
  const inner = search.get(VERCEL_PATH_PARAM);
  if (inner === null) return rawUrl;

  search.delete(VERCEL_PATH_PARAM);
  const path = "/api/" + inner.replace(/^\/+/, "");
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
