import React, { useState } from 'react';
import { 
  ShoppingBag, Phone, MapPin, Clock, 
  User, LogIn, UserPlus, LogOut, ChevronDown 
} from 'lucide-react';
import type { RestaurantSettings, AuthUser } from '../types';

interface NavbarProps {
  restaurant: RestaurantSettings | null;
  currentUser: AuthUser | null;
  cartCount: number;
  onOpenCart: () => void;
  onOpenAuth: (initialMode: 'login' | 'register') => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  restaurant,
  currentUser,
  cartCount,
  onOpenCart,
  onOpenAuth,
  onLogout,
}) => {
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-16 sm:h-20">
          {/* Logo & Restaurant */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="/logo-savora-sm.png"
              alt="Savora"
              width={64}
              height={64}
              className="w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 object-contain shrink-0"
            />
            <div className="min-w-0">
              <span className="text-sm sm:text-xl font-bold tracking-tight text-stone-900 block leading-tight truncate max-w-[7.5rem] sm:max-w-none">
                {restaurant?.restaurant_name || 'Savora'}
              </span>
              <span className="text-[10px] sm:text-xs font-medium text-stone-500 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-orange-600 shrink-0" />
                <span className="truncate">
                  {restaurant?.city ? `${restaurant.city} • Ouvert` : 'Cuisine & Grillades'}
                </span>
              </span>
            </div>
          </div>

          {/* Quick contact */}
          <div className="hidden lg:flex items-center gap-6 text-sm font-medium text-stone-600">
            {restaurant?.phone && (
              <a
                href={`tel:${restaurant.phone}`}
                className="flex items-center gap-2 hover:text-orange-600 transition-colors"
              >
                <Phone className="w-4 h-4 text-orange-600" />
                <span>{restaurant.phone}</span>
              </a>
            )}
            <div className="flex items-center gap-1.5 text-stone-500">
              <Clock className="w-4 h-4 text-stone-400" />
              <span>Service continu</span>
            </div>
          </div>

          {/* User Auth Buttons & Cart */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {currentUser ? (
              /* User logged in */
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-semibold text-stone-800 transition-all cursor-pointer"
                >
                  <div className="w-6 h-6 rounded-full bg-orange-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                    {(currentUser.name || currentUser.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden min-[380px]:inline max-w-[70px] sm:max-w-[100px] truncate">{currentUser.name}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-stone-200 py-2 z-50 animate-fade-in">
                    <div className="px-4 py-2 border-b border-stone-100">
                      <p className="text-xs font-bold text-stone-900 truncate">{currentUser.name}</p>
                      <p className="text-[10px] text-stone-400 truncate">{currentUser.email}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 font-semibold text-[10px]">
                        Rôle : {currentUser.role}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onOpenAuth('login');
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs text-stone-700 hover:bg-stone-50 font-medium flex items-center gap-2"
                    >
                      <User className="w-3.5 h-3.5 text-stone-500" />
                      <span>{currentUser.role === 'customer' ? 'Mon Compte' : 'Tableau de bord gérant'}</span>
                    </button>

                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs text-rose-600 hover:bg-rose-50 font-medium flex items-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Se déconnecter</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* User not logged in: Se connecter / S'inscrire */
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  onClick={() => onOpenAuth('login')}
                  aria-label="Se connecter"
                  title="Se connecter"
                  className="text-stone-700 hover:text-orange-600 text-xs font-bold p-2 md:px-3 md:py-2 rounded-xl hover:bg-stone-100 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <LogIn className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="hidden md:inline">Se connecter</span>
                </button>

                <button
                  onClick={() => onOpenAuth('register')}
                  aria-label="S'inscrire"
                  title="S'inscrire"
                  className="bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold p-2 md:px-3.5 md:py-2 rounded-xl transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="hidden md:inline">S’inscrire</span>
                </button>
              </div>
            )}

            {/* Cart Button */}
            <button
              onClick={onOpenCart}
              aria-label={`Ouvrir le panier${cartCount > 0 ? ` (${cartCount} article${cartCount > 1 ? 's' : ''})` : ''}`}
              className="relative flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-2.5 sm:px-3.5 py-2 min-h-10 rounded-xl font-medium transition-all shadow-sm active:scale-95 cursor-pointer ml-0.5 sm:ml-1"
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="text-xs font-bold hidden sm:inline">Panier</span>
              {cartCount > 0 && (
                <span className="bg-white text-orange-600 text-xs font-black w-5 h-5 rounded-full flex items-center justify-center -mr-1">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
