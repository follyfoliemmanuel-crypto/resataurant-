import React from 'react';
import { Sparkles, Utensils, Clock, Bike, ShieldCheck } from 'lucide-react';
import type { RestaurantSettings } from '../types';

interface HeroProps {
  restaurant: RestaurantSettings | null;
  onExploreMenu: () => void;
}

export const Hero: React.FC<HeroProps> = ({ restaurant, onExploreMenu }) => {
  return (
    <div className="relative overflow-hidden bg-gradient-to-b from-stone-900 to-stone-950 text-white py-12 sm:py-24">
      {/* Decorative ambient background */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-orange-500 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-amber-600 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[11px] sm:text-xs font-semibold uppercase tracking-wider mb-5 sm:mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Saveurs authentiques & grillades</span>
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white mb-4 sm:mb-6 leading-tight">
            {restaurant?.restaurant_name || 'L’excellence culinaire au feu de bois.'}
          </h1>

          <p className="text-base sm:text-xl text-stone-300 mb-6 sm:mb-8 leading-relaxed font-light">
            {restaurant?.description ||
              'Découvrez nos spécialités cuisinées avec passion, des viandes savoureuses et des accompagnements gourmands à déguster sur place ou à emporter.'}
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4">
            <button
              onClick={onExploreMenu}
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold transition-all shadow-lg shadow-orange-600/30 active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Utensils className="w-5 h-5" />
              <span>Consulter la Carte</span>
            </button>
            <div className="text-xs text-stone-400 flex items-center gap-1.5 justify-center sm:justify-start">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Commandes ouvertes aujourd’hui</span>
            </div>
          </div>
        </div>

        {/* Value props badges */}
        <div className="mt-10 sm:mt-14 grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-4 gap-4 border-t border-stone-800 pt-6 sm:pt-8">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-stone-800/80 text-orange-400">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Livraison Rapide</p>
              <p className="text-xs text-stone-400">Ou retrait sur place</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-stone-800/80 text-orange-400">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Préparé Minute</p>
              <p className="text-xs text-stone-400">Chaud & savoureux</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-stone-800/80 text-orange-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Produits Frais</p>
              <p className="text-xs text-stone-400">Qualité sélectionnée</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-stone-800/80 text-orange-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">WhatsApp Direct</p>
              <p className="text-xs text-stone-400">Confirmation instantanée</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
