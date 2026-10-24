import { HttpError } from "./http.js";

/** Taille maximale de l'image décodée (le client compresse avant envoi). */
export const MAX_IMAGE_BYTES = 800 * 1024;
const MAX_IMAGE_URL_LENGTH = 2048;

const DATA_URL_PATTERN =
  /^data:(image\/(?:jpe?g|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i;

export type ParsedImageData = {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: Buffer;
};

function normalizeMimeType(value: string): ParsedImageData["mimeType"] {
  const normalized = value.toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized as ParsedImageData["mimeType"];
}

function hasExpectedSignature(mimeType: string, data: Buffer): boolean {
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return (
      data.length >= 8 &&
      data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  }
  if (mimeType === "image/gif") {
    const header = data.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      data.length >= 12 &&
      data.subarray(0, 4).toString("ascii") === "RIFF" &&
      data.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

/**
 * Décode une image envoyée par le navigateur sous forme de data URL.
 * On vérifie le type MIME, la taille et la signature binaire pour ne jamais
 * stocker un fichier arbitraire dans la table des images.
 */
export function parseImageDataUrl(value: unknown): ParsedImageData | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "Format de photo invalide.", "invalid_image");
  }

  const match = DATA_URL_PATTERN.exec(value.trim());
  if (!match) {
    throw new HttpError(
      400,
      "Format de photo invalide. Utilisez une image JPG, PNG, WebP ou GIF.",
      "invalid_image",
    );
  }

  const mimeType = normalizeMimeType(match[1]);
  const data = Buffer.from(match[2], "base64");

  if (data.length === 0) {
    throw new HttpError(400, "La photo est vide.", "invalid_image");
  }
  if (data.length > MAX_IMAGE_BYTES) {
    throw new HttpError(
      413,
      "La photo est trop lourde. Choisissez une image plus légère.",
      "image_too_large",
    );
  }
  if (!hasExpectedSignature(mimeType, data)) {
    throw new HttpError(
      400,
      "Le fichier ne correspond pas à une image valide.",
      "invalid_image",
    );
  }

  return { mimeType, data };
}

/**
 * Valide une URL de photo externe ou un chemin public local.
 * Les data URLs doivent passer par `parseImageDataUrl` et être stockées en base.
 */
export function normalizeImageUrl(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new HttpError(400, "Lien de photo invalide.", "invalid_image_url");
  }

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_IMAGE_URL_LENGTH) {
    throw new HttpError(400, "Lien de photo trop long.", "invalid_image_url");
  }
  if (trimmed.startsWith("data:")) {
    throw new HttpError(
      400,
      "Envoyez la photo via le champ d'import prévu à cet effet.",
      "invalid_image_url",
    );
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, "Lien de photo invalide.", "invalid_image_url");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(
      400,
      "Le lien de la photo doit commencer par http:// ou https://.",
      "invalid_image_url",
    );
  }

  return trimmed;
}
