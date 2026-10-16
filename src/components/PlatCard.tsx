import React, { useState } from 'react';
import { Plus, Flame, Utensils } from 'lucide-react';
import type { Plat } from '../types';

interface PlatCardProps {
  plat: Plat;
  currency: string;
  onAddToCart: (plat: Plat) => void;
}

export const PlatCard: React.FC<PlatCardProps> = ({ plat, currency, onAddToCart }) => {
  const [imageError, setImageError] = useState(false);
  const formattedPrice = new Intl.NumberFormat('fr-FR').format(Number(plat.price));

  return (
    <div className="group bg-white rounded-2xl border border-stone-200/90 hover:border-orange-200 hover:shadow-xl hover:shadow-orange-500/5 transition-all duration-300 flex flex-col justify-between overflow-hidden">
      {/* Photo du plat */}
      <div className="relative w-full h-48 bg-stone-100 overflow-hidden">
        {plat.image_url && !imageError ? (
          <img
            src={plat.image_url}
            alt={plat.name}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-tr from-stone-100 to-stone-200 text-stone-400">
            <Utensils className="w-8 h-8 opacity-40 mb-1" />
            <span className="text-[11px] font-medium text-stone-400">Saveur Savora</span>
          </div>
        )}

        {/* Badge Populaire */}
        {plat.is_popular && (
          <div className="absolute top-3 right-3 bg-stone-900/80 backdrop-blur-xs text-amber-400 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 shadow-sm">
            <Flame className="w-3.5 h-3.5 fill-amber-400" />
            <span>Populaire</span>
          </div>
        )}
      </div>

      {/* Informations */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-stone-900 text-lg leading-snug group-hover:text-orange-600 transition-colors mb-1.5">
            {plat.name}
          </h3>

          <p className="text-xs text-stone-500 line-clamp-2 leading-relaxed mb-4">
            {plat.description || 'Préparé avec soin par notre brigade avec des ingrédients frais de saison.'}
          </p>
        </div>

        <div className="pt-4 border-t border-stone-100 flex items-center justify-between mt-auto">
          <div className="flex flex-col">
            <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">Prix</span>
            <span className="text-lg font-extrabold text-stone-900">
              {formattedPrice} <span className="text-xs font-semibold text-stone-500">{currency}</span>
            </span>
          </div>

          <button
            onClick={() => onAddToCart(plat)}
            className="bg-stone-900 hover:bg-orange-600 text-white p-2.5 rounded-xl font-semibold transition-all flex items-center gap-1.5 shadow-sm active:scale-95 cursor-pointer"
            title="Ajouter au panier"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-bold pr-1">Commander</span>
          </button>
        </div>
      </div>
    </div>
  );
};
