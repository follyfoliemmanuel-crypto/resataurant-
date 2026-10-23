import React, { useEffect, useRef, useState } from "react";
import { X, Trash2, Plus, Minus, ArrowRight, MessageCircle, Bike, Store, Tag } from "lucide-react";
import type { CartItem, RestaurantSettings } from "../types";
import { checkPromo, submitOrder } from "../api";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  restaurant: RestaurantSettings | null;
  onUpdateQuantity: (platId: string, delta: number) => void;
  onClearCart: () => void;
  onOrderSuccess: (orderData: { order: any; whatsappUrl?: string }) => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen, onClose, cart, restaurant, onUpdateQuantity, onClearCart, onOrderSuccess,
}) => {
  const [step, setStep] = useState<"cart" | "checkout">("cart");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; type: string; value: number } | null>(null);
  const [promoError, setPromoError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const callbacksRef = useRef({ onClearCart, onOrderSuccess });

  useEffect(() => {
    callbacksRef.current = { onClearCart, onOrderSuccess };
  }, [onClearCart, onOrderSuccess]);

  if (!isOpen) return null;

  const currency = restaurant?.currency || "XOF";
  const subtotal = cart.reduce((sum, item) => sum + Number(item.plat.price) * item.quantity, 0);
  let discount = 0;
  if (appliedPromo) discount = appliedPromo.type === "percent" ? subtotal * appliedPromo.value / 100 : Math.min(subtotal, appliedPromo.value);
  const deliveryFee = deliveryMethod === "delivery" ? Number(restaurant?.delivery_fee || 0) : 0;
  const total = Math.max(0, subtotal + deliveryFee - discount);
  const formatMoney = (amount: number) => new Intl.NumberFormat("fr-FR").format(amount);

  const handleApplyPromo = async () => {
    if (!promoCodeInput.trim()) return;
    setPromoError("");
    try {
      const res = await checkPromo(
        promoCodeInput.trim(),
        subtotal,
        customerEmail.trim() || undefined,
      );
      if (res.valid && res.discountType && res.discountValue != null) {
        setAppliedPromo({
          code: promoCodeInput.trim().toUpperCase(),
          type: res.discountType as "percent" | "fixed",
          value: res.discountValue,
        });
        setPromoCodeInput("");
      } else setPromoError(res.message || "Code promo invalide.");
    } catch { setPromoError("Impossible de vérifier le code promotionnel."); }
  };

  const handleConfirmOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError("");
    if (!customerName.trim() || !customerPhone.trim()) return setSubmitError("Veuillez renseigner votre nom et votre numéro de téléphone.");
    if (deliveryMethod === "delivery" && !deliveryAddress.trim()) return setSubmitError("Veuillez indiquer une adresse de livraison.");
    setIsSubmitting(true);
    try {
      const res = await submitOrder({
        items: cart.map(item => ({ platId: item.plat.id, quantity: item.quantity })),
        customer: { name: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() || undefined },
        deliveryMethod,
        address: deliveryMethod === "delivery" ? deliveryAddress.trim() : undefined,
        note: orderNote.trim() || undefined,
        promoCode: appliedPromo?.code,
      });
      if (!res.success || !res.order) throw new Error(res.error || "Erreur lors de la création de la commande.");
      callbacksRef.current.onClearCart();
      callbacksRef.current.onOrderSuccess({ order: res.order, whatsappUrl: res.whatsappUrl });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Une erreur inattendue est survenue.");
    } finally { setIsSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
          <div className="p-4 sm:p-5 border-b border-stone-200 flex items-center justify-between gap-3 bg-stone-50">
            <div className="min-w-0"><h2 className="text-lg font-bold text-stone-900 truncate">{step === "cart" ? "Votre Panier" : "Détails de la commande"}</h2><p className="text-xs text-stone-500">{cart.length === 0 ? "Aucun article" : `${cart.reduce((a, b) => a + b.quantity, 0)} article(s)`}</p></div>
            <button type="button" onClick={onClose} className="p-2 -mr-1 text-stone-400 hover:text-stone-700 rounded-lg shrink-0" aria-label="Fermer le panier"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
            {cart.length === 0 ? <div className="text-center py-16 text-stone-400"><Store className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-stone-600 font-medium text-sm">Votre panier est vide</p><p className="text-xs mt-1">Parcourez la carte et ajoutez vos plats préférés.</p></div> : step === "cart" ? <>
              <div className="divide-y divide-stone-100">
                {cart.map(item => (
                  <div key={item.plat.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.plat.name}</p>
                        <p className="text-xs text-stone-500">{formatMoney(Number(item.plat.price))} {currency}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.plat.id, -item.quantity)}
                        aria-label={`Retirer ${item.plat.name}`}
                        className="p-2 -mr-1 -mt-1 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-0.5 bg-stone-100 rounded-xl p-1">
                        <button type="button" onClick={() => onUpdateQuantity(item.plat.id, -1)} aria-label={`Diminuer ${item.plat.name}`} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white active:scale-95 transition-all">
                          <Minus className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-bold w-6 text-center" aria-live="polite">{item.quantity}</span>
                        <button type="button" onClick={() => onUpdateQuantity(item.plat.id, 1)} aria-label={`Augmenter ${item.plat.name}`} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-white active:scale-95 transition-all">
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-sm font-bold">{formatMoney(Number(item.plat.price) * item.quantity)} {currency}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-4 border-t border-stone-100"><label className="block text-xs font-semibold mb-1.5 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5 text-orange-600" />Code promotionnel</label>{appliedPromo ? <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl text-xs text-emerald-800"><span>Code <strong>{appliedPromo.code}</strong> appliqué</span><button type="button" onClick={() => setAppliedPromo(null)} className="font-bold ml-2">Retirer</button></div> : <div className="flex gap-2"><input value={promoCodeInput} onChange={e => setPromoCodeInput(e.target.value)} placeholder="Ex. BIENVENUE10" className="flex-1 min-w-0 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-xs uppercase" /><button type="button" onClick={handleApplyPromo} className="px-3 py-2 bg-stone-900 text-white rounded-xl text-xs font-semibold shrink-0">Appliquer</button></div>}{promoError && <p className="text-xs text-rose-600 mt-1">{promoError}</p>}</div>
            </> : <form id="checkout-form" onSubmit={handleConfirmOrder} className="space-y-4">
              {submitError && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">{submitError}</div>}
              <div><label className="block text-xs font-semibold mb-1">Nom complet *</label><input required value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold mb-1">Numéro de téléphone *</label><input required type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="Ex. 90 00 00 00" className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold mb-1">Email (optionnel)</label><input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm" /></div>
              <div><label className="block text-xs font-semibold mb-1">Mode de réception</label><div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2"><button type="button" onClick={() => setDeliveryMethod("pickup")} className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 ${deliveryMethod === "pickup" ? "bg-orange-50 border-orange-500 text-orange-800" : "border-stone-200"}`}><Store className="w-4 h-4" />À emporter</button><button type="button" onClick={() => setDeliveryMethod("delivery")} className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 text-center ${deliveryMethod === "delivery" ? "bg-orange-50 border-orange-500 text-orange-800" : "border-stone-200"}`}><Bike className="w-4 h-4 shrink-0" />Livraison (+{formatMoney(Number(restaurant?.delivery_fee || 0))} {currency})</button></div></div>
              {deliveryMethod === "delivery" && <div><label className="block text-xs font-semibold mb-1">Adresse de livraison *</label><textarea required rows={2} value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm" /></div>}
              <div><label className="block text-xs font-semibold mb-1">Note ou instructions (optionnel)</label><textarea rows={2} value={orderNote} onChange={e => setOrderNote(e.target.value)} className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm" /></div>
            </form>}
          </div>
          {cart.length > 0 && <div className="p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-stone-200 bg-stone-50 space-y-3"><div className="space-y-1.5 text-xs text-stone-600"><div className="flex justify-between"><span>Sous-total</span><span className="font-semibold">{formatMoney(subtotal)} {currency}</span></div>{deliveryMethod === "delivery" && <div className="flex justify-between"><span>Frais de livraison</span><span>{formatMoney(deliveryFee)} {currency}</span></div>}{discount > 0 && <div className="flex justify-between text-emerald-600"><span>Remise promotionnelle</span><span>-{formatMoney(discount)} {currency}</span></div>}<div className="flex justify-between text-sm font-bold pt-2 border-t border-stone-200"><span>Total à payer</span><span className="text-base text-orange-600">{formatMoney(total)} {currency}</span></div></div>
            {step === "cart" ? <button type="button" onClick={() => { setSubmitError(""); setStep("checkout"); }} className="w-full bg-stone-900 hover:bg-orange-600 text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2"><span>Passer la commande</span><ArrowRight className="w-4 h-4" /></button> : <div className="flex gap-2"><button type="button" disabled={isSubmitting} onClick={() => { setSubmitError(""); setStep("cart"); }} className="px-4 py-3 min-h-11 rounded-xl border border-stone-200 text-xs font-semibold">Retour</button><button type="submit" form="checkout-form" disabled={isSubmitting} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 min-h-11 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"><MessageCircle className="w-4 h-4" /><span>{isSubmitting ? "Traitement..." : "Valider via WhatsApp"}</span></button></div>}
          </div>}
        </div>
      </div>
    </div>
  );
};
