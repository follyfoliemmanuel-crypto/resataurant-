export type CartLineInput = { platId: string; quantity: number };
export type PricedLine = { platId: string; name: string; quantity: number; unitPrice: number; subtotal: number };

export function roundMoney(value: number) {
  if (!Number.isFinite(value)) throw new Error("Montant invalide");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function applyPromotion(subtotal: number, promo: { type: "percent" | "fixed"; value: number } | null) {
  if (!promo) return 0;
  if (!Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(promo.value) || promo.value < 0) throw new Error("Promotion invalide");
  if (promo.type === "percent") return roundMoney(subtotal * (Math.min(100, promo.value) / 100));
  return roundMoney(Math.min(subtotal, promo.value));
}

export function computeOrderTotals(args: { lines: PricedLine[]; deliveryMethod: "pickup" | "delivery"; deliveryEnabled: boolean; deliveryFee: number; discount: number }) {
  if (args.deliveryMethod === "delivery" && !args.deliveryEnabled) throw new Error("delivery_disabled");
  if (!Number.isFinite(args.deliveryFee) || args.deliveryFee < 0 || !Number.isFinite(args.discount) || args.discount < 0) throw new Error("Montant invalide");
  for (const line of args.lines) {
    if (!Number.isFinite(line.subtotal) || line.subtotal < 0 || !Number.isFinite(line.quantity) || line.quantity < 1) throw new Error("Ligne de commande invalide");
  }
  const subtotal = roundMoney(args.lines.reduce((sum, line) => sum + line.subtotal, 0));
  const deliveryFee = args.deliveryMethod === "delivery" ? roundMoney(args.deliveryFee) : 0;
  const discount = roundMoney(Math.min(subtotal, args.discount));
  const total = roundMoney(Math.max(0, subtotal + deliveryFee - discount));
  return { subtotal, deliveryFee, discount, total };
}

export function buildWhatsappMessage(args: { orderNumber: string; customerName: string; phone: string; lines: { name: string; quantity: number }[]; subtotal: number; deliveryFee: number; total: number; method: string; address?: string | null; note?: string | null; currency: string }) {
  const money = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: args.currency }).format(n);
  const products = args.lines.map((line) => `- ${line.name} x${line.quantity}`).join("\n");
  return ["Nouvelle commande", "", `Commande : #${args.orderNumber}`, "", "Client :", args.customerName, `Téléphone : ${args.phone}`, "", "Produits :", products, "", `Sous-total : ${money(args.subtotal)}`, `Livraison : ${money(args.deliveryFee)}`, `Total : ${money(args.total)}`, "", `Mode : ${args.method === "delivery" ? "Livraison" : "Retrait"}`, args.address ? `Adresse : ${args.address}` : "", args.note ? `Note : ${args.note}` : ""].filter((line) => line !== "").join("\n");
}

export function whatsappUrl(number: string, message: string) {
  const digits = number.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("Numéro WhatsApp invalide");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
