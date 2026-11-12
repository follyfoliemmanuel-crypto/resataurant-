import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { HttpError } from "./http.js";

export interface GeniusPayCustomer {
  name: string;
  email?: string;
  phone: string;
}

export interface GeniusPayPaymentParams {
  amount: number;
  currency?: string;
  description: string;
  customer: GeniusPayCustomer;
  success_url: string;
  error_url: string;
  metadata: {
    order_id: string;
    payment_id?: string;
    source?: string;
    [key: string]: unknown;
  };
}

export interface GeniusPayPaymentResult {
  success: boolean;
  checkoutUrl: string;
  providerReference?: string;
  providerTransactionId?: string;
  isSimulated?: boolean;
  raw?: unknown;
}

export interface GeniusPayWebhookEvent {
  event: string;
  data: {
    id?: string;
    reference?: string;
    transaction_id?: string;
    amount?: number | string;
    currency?: string;
    status?: string;
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    metadata?: {
      order_id?: string;
      payment_id?: string;
      source?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  id?: string;
  timestamp?: number | string;
  [key: string]: unknown;
}

export type GeniusPayInternalStatus =
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired"
  | "processing"
  | "pending";

/**
 * Mappe l'événement webhook GeniusPay vers le statut de paiement interne de Savora.
 */
export function mapGeniusPayEventToStatus(
  eventName: string,
): GeniusPayInternalStatus | null {
  const normalized = (eventName || "").toLowerCase().trim();
  switch (normalized) {
    case "payment.success":
    case "payment.succeeded":
    case "success":
    case "paid":
      return "paid";
    case "payment.failed":
    case "failed":
      return "failed";
    case "payment.cancelled":
    case "payment.canceled":
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "payment.refunded":
    case "refunded":
      return "refunded";
    case "payment.expired":
    case "expired":
      return "expired";
    case "payment.processing":
    case "processing":
      return "processing";
    default:
      return null;
  }
}

/**
 * Calcule la signature HMAC-SHA256 selon la formule GeniusPay :
 * HMAC-SHA256(timestamp + "." + json_payload, webhook_secret)
 */
export function computeGeniusPaySignature(
  rawBody: string,
  timestamp: string | number,
  secret: string,
): string {
  if (!secret) return "";
  const message = `${timestamp}.${rawBody}`;
  return createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Vérifie l'en-tête de signature du webhook avec tolérance de temps (5 minutes max par défaut).
 */
export function verifyGeniusPayWebhookSignature(params: {
  rawBody: string;
  signature?: string | null;
  timestamp?: string | number | null;
  secret?: string | null;
  toleranceSeconds?: number;
}): { valid: boolean; reason?: string } {
  const {
    rawBody,
    signature,
    timestamp,
    secret = config.geniuspay.webhookSecret,
    toleranceSeconds = 300, // 5 minutes
  } = params;

  if (!secret) {
    return { valid: false, reason: "secret_not_configured" };
  }
  if (!signature || typeof signature !== "string") {
    return { valid: false, reason: "missing_signature" };
  }
  if (!timestamp) {
    return { valid: false, reason: "missing_timestamp" };
  }

  // Vérification de la tolérance d'horodatage
  const rawTsNum = Number(timestamp);
  if (!Number.isFinite(rawTsNum) || rawTsNum <= 0) {
    return { valid: false, reason: "invalid_timestamp_format" };
  }

  // Conversion en secondes si l'horodatage a été fourni en millisecondes
  const tsInSeconds = rawTsNum > 1e11 ? Math.floor(rawTsNum / 1000) : Math.floor(rawTsNum);
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowInSeconds - tsInSeconds);

  if (drift > toleranceSeconds) {
    return { valid: false, reason: "timestamp_expired" };
  }

  // Nettoyage de la signature (certaines passerelles préfixent sha256= ou v1=)
  let cleanSig = signature.trim();
  if (cleanSig.startsWith("sha256=")) cleanSig = cleanSig.slice(7);
  else if (cleanSig.startsWith("v1=")) cleanSig = cleanSig.slice(3);

  const expectedHex = computeGeniusPaySignature(rawBody, timestamp, secret);

  try {
    const expectedBuf = Buffer.from(expectedHex, "hex");
    const actualBuf = Buffer.from(cleanSig, "hex");

    if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) {
      return { valid: false, reason: "signature_mismatch" };
    }

    if (!timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, reason: "signature_mismatch" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid_signature_encoding" };
  }
}

/**
 * Crée un paiement auprès de l'API GeniusPay et récupère l'URL de checkout hébergé.
 */
export async function createGeniusPayPayment(
  params: GeniusPayPaymentParams,
  options?: {
    apiKey?: string;
    apiSecret?: string;
    baseUrl?: string;
  },
): Promise<GeniusPayPaymentResult> {
  const apiKey = options?.apiKey ?? config.geniuspay.apiKey;
  const apiSecret = options?.apiSecret ?? config.geniuspay.apiSecret;
  const baseUrl = options?.baseUrl ?? config.geniuspay.baseUrl;

  const orderId = params.metadata.order_id;
  const paymentId = params.metadata.payment_id ?? "";

  // Mode développement / test sans clés : émule un checkout sandbox fonctionnel
  if (!apiKey || !apiSecret) {
    if (!config.isProd) {
      const mockCheckoutUrl = `${config.appUrl}/paiement/simulation-geniuspay?order_id=${encodeURIComponent(orderId)}&payment_id=${encodeURIComponent(paymentId)}&amount=${encodeURIComponent(params.amount)}`;
      return {
        success: true,
        checkoutUrl: mockCheckoutUrl,
        providerReference: `MOCK_REF_${Date.now()}`,
        providerTransactionId: `MOCK_TX_${Date.now()}`,
        isSimulated: true,
      };
    }
    throw new HttpError(
      503,
      "Le service de paiement GeniusPay n'est pas encore configuré (clés API manquantes).",
    );
  }

  // Requête officielle vers POST /api/v1/merchant/payments
  // Sans payment_method pour utiliser le checkout hébergé multi-opérateurs
  const endpoint = `${baseUrl}/payments`;
  const payload = {
    amount: params.amount,
    currency: params.currency ?? "XOF",
    description: params.description,
    customer: {
      name: params.customer.name,
      email: params.customer.email || undefined,
      phone: params.customer.phone,
    },
    success_url: params.success_url,
    error_url: params.error_url,
    metadata: {
      order_id: params.metadata.order_id,
      payment_id: params.metadata.payment_id,
      source: params.metadata.source ?? "savora",
    },
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error(
      "[GeniusPay] Erreur de connexion lors de l'initiation :",
      err instanceof Error ? err.message : err,
    );
    throw new HttpError(
      502,
      "Impossible de joindre la passerelle de paiement GeniusPay. Réessayez dans un instant.",
    );
  }

  const rawText = await response.text();
  let jsonBody: any = {};
  try {
    jsonBody = JSON.parse(rawText);
  } catch {
    jsonBody = { raw: rawText };
  }

  if (!response.ok) {
    const errorMsg =
      jsonBody.message ||
      jsonBody.error ||
      `Erreur passerelle GeniusPay (${response.status})`;
    console.error("[GeniusPay] Réponse erreur API :", response.status, rawText);
    throw new HttpError(502, `GeniusPay a refusé la demande : ${errorMsg}`);
  }

  // Extraction robuste de l'URL de checkout dans la structure GeniusPay
  const data = jsonBody.data || jsonBody;
  const checkoutUrl =
    data.checkout_url ||
    data.url ||
    jsonBody.checkout_url ||
    jsonBody.url;

  if (!checkoutUrl) {
    console.error("[GeniusPay] checkout_url introuvable dans la réponse :", rawText);
    throw new HttpError(
      502,
      "La passerelle GeniusPay n'a pas renvoyé d'URL de checkout valide.",
    );
  }

  const providerReference = data.reference || jsonBody.reference || data.id || jsonBody.id;
  const providerTransactionId = data.id || jsonBody.id || providerReference;

  return {
    success: true,
    checkoutUrl,
    providerReference,
    providerTransactionId,
    raw: jsonBody,
  };
}

/**
 * Vérifie l'état d'un paiement directement auprès de l'API GeniusPay
 * (GET /api/v1/merchant/payments/:id)
 */
export async function fetchGeniusPayPayment(
  paymentOrTransactionId: string,
  options?: {
    apiKey?: string;
    apiSecret?: string;
    baseUrl?: string;
  },
): Promise<{
  success: boolean;
  status: GeniusPayInternalStatus | "unknown";
  raw?: unknown;
}> {
  const apiKey = options?.apiKey ?? config.geniuspay.apiKey;
  const apiSecret = options?.apiSecret ?? config.geniuspay.apiSecret;
  const baseUrl = options?.baseUrl ?? config.geniuspay.baseUrl;

  if (!apiKey || !apiSecret) {
    return { success: false, status: "unknown" };
  }

  try {
    const endpoint = `${baseUrl}/payments/${encodeURIComponent(paymentOrTransactionId)}`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { success: false, status: "unknown" };
    }

    const data = (await response.json()) as any;
    const payload = data?.data || data || {};
    const remoteStatus = String(payload.status || payload.state || "").toLowerCase();
    const mapped = mapGeniusPayEventToStatus(remoteStatus) ?? "unknown";

    return {
      success: true,
      status: mapped,
      raw: data,
    };
  } catch (err) {
    console.warn(
      "[GeniusPay] Échec de la vérification directe :",
      err instanceof Error ? err.message : err,
    );
    return { success: false, status: "unknown" };
  }
}
