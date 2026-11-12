import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  CreditCard,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import {
  getGeniusPayPaymentStatus,
  initiateGeniusPayPayment,
  simulateGeniusPayPayment,
} from "../api";
import type { RestaurantSettings } from "../types";

interface PaymentStatusPageProps {
  mode: "success" | "error" | "simulation";
  restaurant: RestaurantSettings | null;
  onNavigateHome: () => void;
}

export const PaymentStatusPage: React.FC<PaymentStatusPageProps> = ({
  mode,
  restaurant,
  onNavigateHome,
}) => {
  const [params] = useState<{
    orderId: string;
    paymentId: string;
    amount: string;
  }>(() => {
    if (typeof window === "undefined") return { orderId: "", paymentId: "", amount: "" };
    const searchParams = new URLSearchParams(window.location.search);
    return {
      orderId: searchParams.get("order_id") || searchParams.get("orderId") || "",
      paymentId: searchParams.get("payment_id") || searchParams.get("paymentId") || "",
      amount: searchParams.get("amount") || "",
    };
  });

  const [loading, setLoading] = useState(mode === "success");
  const [pollCount, setPollCount] = useState(0);
  const [paymentData, setPaymentData] = useState<{
    payment?: {
      id: string;
      status: string;
      amount: number;
      currency: string;
      provider: string;
      checkoutUrl?: string;
    };
    order?: {
      id: string;
      orderNumber: string;
      status: string;
      total: number;
      deliveryMethod: string;
    };
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const currency = restaurant?.currency || "XOF";
  const formatMoney = (amount: number) =>
    new Intl.NumberFormat("fr-FR").format(amount);



  // Vérification et sondage du statut pour la page de succès
  useEffect(() => {
    if (mode !== "success" || !params.orderId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      try {
        const res = await getGeniusPayPaymentStatus({
          orderId: params.orderId,
          paymentId: params.paymentId || undefined,
        });

        if (res.success) {
          setPaymentData({ payment: res.payment, order: res.order });

          const status = res.payment?.status;
          if (status === "paid") {
            setLoading(false);
            return;
          }

          if (status === "failed" || status === "cancelled") {
            setLoading(false);
            setErrorMessage("Le paiement a été rejeté ou annulé.");
            return;
          }

          // En attente / processing : on relance jusqu'à 6 fois (15s)
          if (pollCount < 6) {
            timer = setTimeout(() => {
              setPollCount((prev) => prev + 1);
            }, 2500);
          } else {
            setLoading(false);
          }
        } else {
          setErrorMessage(res.error || "Impossible de vérifier le statut.");
          setLoading(false);
        }
      } catch {
        setErrorMessage("Erreur de connexion au serveur.");
        setLoading(false);
      }
    };

    checkStatus();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [mode, params.orderId, params.paymentId, pollCount]);

  // Relance manuelle de vérification
  const handleManualRefresh = () => {
    setLoading(true);
    setPollCount(0);
  };

  // Réessayer le paiement GeniusPay
  const handleRetryPayment = async () => {
    if (!params.orderId || actionLoading) return;
    setActionLoading(true);
    setErrorMessage("");
    try {
      const res = await initiateGeniusPayPayment(params.orderId);
      if (res.success && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
      } else {
        setErrorMessage(
          res.error || "Impossible d'initialiser une nouvelle session de paiement.",
        );
      }
    } catch {
      setErrorMessage("Erreur de connexion.");
    } finally {
      setActionLoading(false);
    }
  };

  // Simulation en mode Sandbox
  const handleSimulate = async (status: "paid" | "failed" | "cancelled") => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const res = await simulateGeniusPayPayment({
        paymentId: params.paymentId || undefined,
        orderId: params.orderId || undefined,
        status,
      });

      if (res.success) {
        if (status === "paid") {
          window.location.href = `/paiement/succes?order_id=${encodeURIComponent(params.orderId)}&payment_id=${encodeURIComponent(params.paymentId)}`;
        } else {
          window.location.href = `/paiement/echec?order_id=${encodeURIComponent(params.orderId)}&payment_id=${encodeURIComponent(params.paymentId)}`;
        }
      } else {
        setErrorMessage(res.error || "Échec de la simulation.");
      }
    } catch {
      setErrorMessage("Erreur de communication lors de la simulation.");
    } finally {
      setActionLoading(false);
    }
  };

  const isPaid = paymentData?.payment?.status === "paid";
  const isPending =
    paymentData?.payment?.status === "pending" ||
    paymentData?.payment?.status === "processing";

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-stone-200/80 text-center relative overflow-hidden">
        {/* Bandeau d'ambiance supérieur */}
        <div
          className={`absolute top-0 left-0 right-0 h-2 ${
            mode === "simulation"
              ? "bg-amber-500"
              : isPaid
                ? "bg-emerald-500"
                : mode === "error"
                  ? "bg-rose-500"
                  : "bg-orange-500"
          }`}
        />

        {/* --- SCÉNARIO 1 : SIMULATION EN DÉVELOPPEMENT --- */}
        {mode === "simulation" && (
          <div className="space-y-5">
            <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <ShieldCheck className="w-7 h-7" />
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                Mode Sandbox Développeur
              </span>
              <h2 className="text-xl font-bold text-stone-900 mt-2">
                Checkout GeniusPay Simulé
              </h2>
              <p className="text-xs text-stone-500 mt-1">
                Aucune clé API GeniusPay n'est requise pour tester l'ensemble du cycle de paiement.
              </p>
            </div>

            <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 text-left text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-stone-500">Commande :</span>
                <span className="font-mono font-bold text-stone-800">
                  #{params.orderId.slice(0, 8)}...
                </span>
              </div>
              {params.amount && (
                <div className="flex justify-between">
                  <span className="text-stone-500">Montant total :</span>
                  <span className="font-bold text-orange-600">
                    {formatMoney(Number(params.amount))} {currency}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-stone-500">Passerelle :</span>
                <span className="font-semibold text-stone-800">
                  GeniusPay (Mobile Money & Cartes)
                </span>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleSimulate("paid")}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Simuler Paiement Réussi (payment.success)</span>
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleSimulate("failed")}
                className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all border border-rose-200 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                <span>Simuler Paiement Échoué (payment.failed)</span>
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleSimulate("cancelled")}
                className="w-full bg-stone-100 hover:bg-stone-200 text-stone-600 font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Simuler Annulation Client (payment.cancelled)</span>
              </button>
            </div>
          </div>
        )}

        {/* --- SCÉNARIO 2 : SUCCÈS OU VÉRIFICATION DU PAIEMENT --- */}
        {mode === "success" && (
          <div className="space-y-5">
            {loading ? (
              <div className="py-6 space-y-4">
                <div className="w-14 h-14 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
                  <Loader2 className="w-7 h-7 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-900">
                    Vérification du paiement en cours...
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Nous validons la transaction auprès de GeniusPay. Veuillez patienter un instant.
                  </p>
                </div>
              </div>
            ) : isPaid ? (
              <>
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                    Paiement Validé
                  </span>
                  <h2 className="text-xl font-bold text-stone-900 mt-2">
                    Commande Confirmée !
                  </h2>
                  <p className="text-xs text-stone-500 mt-1">
                    Votre paiement GeniusPay a été reçu et validé avec succès.
                  </p>
                </div>

                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 text-left text-xs space-y-2">
                  {paymentData?.order?.orderNumber && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">N° de commande :</span>
                      <span className="font-mono font-bold text-stone-900">
                        #{paymentData.order.orderNumber}
                      </span>
                    </div>
                  )}
                  {paymentData?.payment?.amount && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Montant réglé :</span>
                      <span className="font-bold text-emerald-700">
                        {formatMoney(paymentData.payment.amount)} {currency}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-stone-500">Moyen :</span>
                    <span className="font-semibold text-stone-800">
                      GeniusPay Mobile Money / Carte
                    </span>
                  </div>
                  {paymentData?.order?.deliveryMethod && (
                    <div className="flex justify-between">
                      <span className="text-stone-500">Réception :</span>
                      <span className="font-medium text-stone-700">
                        {paymentData.order.deliveryMethod === "delivery"
                          ? "Livraison à domicile"
                          : "À emporter"}
                      </span>
                    </div>
                  )}
                </div>

                {restaurant?.whatsapp_number && (
                  <a
                    href={`https://wa.me/${restaurant.whatsapp_number.replace(/\D/g, "")}?text=${encodeURIComponent(
                      `Bonjour, j'ai réglé ma commande #${paymentData?.order?.orderNumber || params.orderId.slice(0, 8)} avec succès via GeniusPay.`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-emerald-600/20"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Informer le restaurant sur WhatsApp</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <button
                  type="button"
                  onClick={onNavigateHome}
                  className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-2.5 rounded-xl text-xs cursor-pointer transition-all"
                >
                  Retour à la carte
                </button>
              </>
            ) : isPending ? (
              <div className="py-2 space-y-4">
                <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    Paiement en attente de validation
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Votre opérateur Mobile Money traite la transaction. Votre commande sera automatiquement validée dès réception de la confirmation.
                  </p>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleManualRefresh}
                    className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-orange-600/20 transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Rafraîchir le statut</span>
                  </button>

                  <button
                    type="button"
                    onClick={onNavigateHome}
                    className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-2.5 rounded-xl text-xs cursor-pointer transition-all"
                  >
                    Retour à l'accueil
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
                  <XCircle className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    Paiement non confirmé
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    {errorMessage ||
                      "Nous n'avons pas encore reçu la confirmation de GeniusPay pour cette commande."}
                  </p>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleRetryPayment}
                    disabled={actionLoading}
                    className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-orange-600/20 disabled:opacity-50"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Réessayer le paiement en ligne</span>
                  </button>

                  <button
                    type="button"
                    onClick={onNavigateHome}
                    className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-2.5 rounded-xl text-xs cursor-pointer transition-all"
                  >
                    Retour à l'accueil
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- SCÉNARIO 3 : ÉCHEC OU ANNULATION --- */}
        {mode === "error" && (
          <div className="space-y-5">
            <div className="w-14 h-14 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <XCircle className="w-8 h-8" />
            </div>

            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-rose-100 text-rose-800">
                Paiement Interrompu
              </span>
              <h2 className="text-xl font-bold text-stone-900 mt-2">
                Le paiement a échoué ou a été annulé
              </h2>
              <p className="text-xs text-stone-500 mt-1">
                Aucun débit n'a été effectué sur votre compte. Votre commande est conservée en attente.
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {errorMessage}
              </div>
            )}

            <div className="space-y-2 pt-2">
              {params.orderId && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleRetryPayment}
                  className="w-full bg-stone-900 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md shadow-stone-900/10 disabled:opacity-50"
                >
                  <CreditCard className="w-4 h-4 text-orange-400" />
                  <span>{actionLoading ? "Redirection..." : "Réessayer avec GeniusPay"}</span>
                </button>
              )}

              {restaurant?.whatsapp_number && (
                <a
                  href={`https://wa.me/${restaurant.whatsapp_number.replace(/\D/g, "")}?text=${encodeURIComponent(
                    `Bonjour, mon paiement GeniusPay n'a pas abouti pour ma commande #${params.orderId.slice(0, 8)}. Je souhaite régler directement.`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all border border-emerald-600 text-center"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Régler avec le restaurant via WhatsApp</span>
                </a>
              )}

              <button
                type="button"
                onClick={onNavigateHome}
                className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-2.5 rounded-xl text-xs cursor-pointer transition-all"
              >
                Retour à la carte
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
