import { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PlatCard } from './components/PlatCard';
import { CartDrawer } from './components/CartDrawer';
import { usePolling } from './hooks/usePolling';
import { useServerEvents } from './hooks/useServerEvents';
import { AdminModal } from './components/AdminModal';
import { 
  fetchRestaurant, fetchMenu, getMe, getSession, logout, verifyEmail 
} from './api';
import type { 
  RestaurantSettings, Category, Plat, CartItem, AuthUser 
} from './types';
import { 
  CheckCircle2, MessageCircle, ExternalLink, Sparkles, 
  MapPin, Phone, Mail 
} from 'lucide-react';
import './App.css';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function App() {
  const [restaurant, setRestaurant] = useState<RestaurantSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [plats, setPlats] = useState<Plat[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  
  // Auth & Admin Modal state
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>('login');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  
  const [orderConfirmation, setOrderConfirmation] = useState<{ order: any; whatsappUrl?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifyNotice, setVerifyNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // Load initial data
  useEffect(() => {
    loadData();
    const params = new URLSearchParams(window.location.search);
    const verifyToken = params.get('verifyToken');
    const tokenForReset = params.get('resetToken');
    const authSuccess = params.get('authSuccess');
    const authError = params.get('authError');

    if (verifyToken) {
      // Le jeton est à usage unique : on le retire de l'URL tout de suite (évite le double appel en StrictMode)
      window.history.replaceState({}, '', window.location.pathname);
      handleVerifyEmail(verifyToken);
    } else if (tokenForReset) {
      window.history.replaceState({}, '', window.location.pathname);
      setResetToken(tokenForReset);
      setAuthMode('reset');
      setIsAuthOpen(true);
    } else if (authSuccess) {
      window.history.replaceState({}, '', window.location.pathname);
      checkAuth();
      setVerifyNotice({ ok: true, text: 'Connexion Google réussie ! Bienvenue sur Savora.' });
    } else if (authError) {
      window.history.replaceState({}, '', window.location.pathname);
      checkAuth();
      setVerifyNotice({ ok: false, text: `Erreur d'authentification : ${authError}` });
    } else {
      checkAuth();
    }
  }, []);

  const handleVerifyEmail = async (token: string) => {
    const res = await verifyEmail(token);
    if (res.success && res.user) {
      setCurrentUser(res.user);
      setVerifyNotice({ ok: true, text: res.message || 'Votre adresse e-mail est confirmée. Vous êtes connecté(e) !' });
    } else {
      await checkAuth();
      setVerifyNotice({ ok: false, text: res.error || 'Lien invalide ou expiré. Inscrivez-vous à nouveau pour recevoir un nouveau lien.' });
    }
  };

  // `silent` = rafraîchissement automatique : pas de spinner, et une panne réseau ne vide pas l'écran
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [restRes, menuRes] = await Promise.all([
      fetchRestaurant(),
      fetchMenu(),
    ]);
    if (!silent || restRes) setRestaurant(prev => (sameJson(prev, restRes) ? prev : restRes));
    if (!silent || menuRes.ok) {
      setCategories(prev => (sameJson(prev, menuRes.categories) ? prev : menuRes.categories));
      setPlats(prev => (sameJson(prev, menuRes.plats) ? prev : menuRes.plats));
    }
    if (!silent) setLoading(false);
  };

  // Actualisation automatique : carte, infos du restaurant et session
  usePolling(() => loadData(true), 10_000);
  useServerEvents(() => loadData(true));
  usePolling(async () => {
    const session = await getSession();
    if (session.ok) setCurrentUser(prev => (sameJson(prev, session.user) ? prev : session.user));
  }, 30_000);

  // Le panier suit la carte : prix à jour, plats retirés ou indisponibles supprimés
  useEffect(() => {
    setCart(prev => {
      if (prev.length === 0) return prev;
      const byId = new Map(plats.map(p => [p.id, p]));
      const next = prev.flatMap(item => {
        const fresh = byId.get(item.plat.id);
        if (!fresh || !fresh.is_available) return [];
        return [sameJson(fresh, item.plat) ? item : { ...item, plat: fresh }];
      });
      return sameJson(next, prev) ? prev : next;
    });
  }, [plats]);

  const checkAuth = async () => {
    const user = await getMe();
    setCurrentUser(user);
  };

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
  };

  const handleOpenAuth = (mode: 'login' | 'register' | 'forgot' | 'reset') => {
    setResetToken(null);
    setAuthMode(mode);
    setIsAuthOpen(true);
  };

  // Cart operations
  const handleAddToCart = (plat: Plat) => {
    setCart(prev => {
      const existing = prev.find(item => item.plat.id === plat.id);
      if (existing) {
        return prev.map(item =>
          item.plat.id === plat.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { plat, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const handleUpdateCartQuantity = (platId: string, delta: number) => {
    setCart(prev => {
      return prev
        .map(item => {
          if (item.plat.id === platId) {
            const nextQty = item.quantity + delta;
            return nextQty > 0 ? { ...item, quantity: nextQty } : null;
          }
          return item;
        })
        .filter((item): item is CartItem => item !== null);
    });
  };

  const handleClearCart = () => {
    setCart([]);
  };

  const handleOrderSuccess = (data: { order: any; whatsappUrl?: string }) => {
    setIsCartOpen(false);
    setOrderConfirmation(data);
    void loadData(true); // stocks / disponibilités à jour après la commande
    if (data.whatsappUrl) {
      window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const filteredPlats = selectedCategory === 'all'
    ? plats
    : plats.filter(p => p.category_id === selectedCategory);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const currency = restaurant?.currency || 'XOF';

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col font-sans">
      {verifyNotice && (
        <div
          role="status"
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[calc(100%-2rem)] rounded-2xl px-4 py-3 text-sm shadow-lg flex items-start gap-3 ${
            verifyNotice.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          <span className="flex-1">{verifyNotice.text}</span>
          <button type="button" onClick={() => setVerifyNotice(null)} className="font-bold cursor-pointer" aria-label="Fermer">×</button>
        </div>
      )}
      <Navbar
        restaurant={restaurant}
        currentUser={currentUser}
        cartCount={cartCount}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenAuth={handleOpenAuth}
        onLogout={handleLogout}
      />

      <Hero
        restaurant={restaurant}
        onExploreMenu={() => {
          const el = document.getElementById('menu-section');
          el?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      {/* Main Menu Section */}
      <main id="menu-section" className="flex-1 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10 sm:py-14 w-full">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-6 sm:mb-8 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-bold text-orange-600 uppercase tracking-widest mb-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Notre Carte du Jour</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight">
              Faits maison avec passion
            </h2>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-stone-900 text-white shadow-sm'
                  : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
              }`}
            >
              Tous ({plats.length})
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-stone-900 text-white shadow-sm'
                    : 'bg-white text-stone-600 hover:bg-stone-100 border border-stone-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Dish Grid with photos */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[1, 2, 3, 4, 5, 6].map(n => (
              <div key={n} className="bg-white rounded-2xl p-5 border border-stone-200 animate-pulse h-64" />
            ))}
          </div>
        ) : filteredPlats.length === 0 ? (
          <div className="bg-white rounded-3xl border border-stone-200 p-8 sm:p-12 text-center text-stone-400">
            <p className="font-semibold text-stone-600 text-base">Aucun plat dans cette sélection</p>
            <p className="text-xs text-stone-400 mt-1">Sélectionnez une autre catégorie pour explorer le menu.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 animate-fade-in">
            {filteredPlats.map(plat => (
              <PlatCard
                key={plat.id}
                plat={plat}
                currency={currency}
                onAddToCart={handleAddToCart}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-stone-900 text-white border-t border-stone-800 py-10 sm:py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <img
                  src="/logo-savora-sm.png"
                  alt="Savora"
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-xl bg-white object-contain p-0.5 shrink-0"
                />
                <h4 className="text-lg font-bold break-words">{restaurant?.restaurant_name || 'Savora'}</h4>
              </div>
              <p className="text-xs text-stone-400 leading-relaxed">
                {restaurant?.description || 'Plateforme de commande et de gestion de restaurant haut de gamme.'}
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-200 mb-3 uppercase tracking-wider">Contact & Coordonnées</h4>
              <ul className="space-y-2 text-xs text-stone-400">
                {restaurant?.address && (
                  <li className="flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">{restaurant.address}, {restaurant.city}</span>
                  </li>
                )}
                {restaurant?.phone && (
                  <li className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span className="min-w-0 break-words">{restaurant.phone}</span>
                  </li>
                )}
                {restaurant?.email && (
                  <li className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span className="min-w-0 break-all">{restaurant.email}</span>
                  </li>
                )}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-bold text-stone-200 mb-3 uppercase tracking-wider">Horaires de service</h4>
              <p className="text-xs text-stone-400 leading-relaxed">
                Du Lundi au Jeudi : 11h30 - 23h00<br />
                Vendredi et Samedi : 11h30 - 00h00<br />
                Dimanche : 12h00 - 22h30
              </p>
            </div>
          </div>

          <div className="border-t border-stone-800 mt-10 pt-6 text-center text-xs text-stone-500 flex flex-col sm:flex-row justify-between items-center gap-2">
            <span>© {new Date().getFullYear()} {restaurant?.restaurant_name || 'Savora'}. Tous droits réservés.</span>
            <span className="text-stone-400">Conçu pour la vente directe & la fidélisation client</span>
          </div>
        </div>
      </footer>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        restaurant={restaurant}
        onUpdateQuantity={handleUpdateCartQuantity}
        onClearCart={handleClearCart}
        onOrderSuccess={handleOrderSuccess}
      />

      {/* Auth & Admin Modal */}
      <AdminModal
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setResetToken(null);
        }}
        currentUser={currentUser}
        onUserChange={setCurrentUser}
        categories={categories}
        plats={plats}
        onRefreshMenu={() => loadData(true)}
        currency={currency}
        initialMode={authMode}
        resetToken={resetToken}
      />

      {/* Order Confirmation Modal */}
      {orderConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs" onClick={() => setOrderConfirmation(null)} />
          <div className="relative bg-white rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl text-center max-h-[90vh] overflow-y-auto">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <h3 className="text-xl font-bold text-stone-900 mb-2">Commande Enregistrée !</h3>
            <p className="text-xs text-stone-500 mb-4">
              Votre commande numéro <strong>#{orderConfirmation.order.order_number}</strong> a bien été prise en compte.
            </p>

            <div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl text-xs text-stone-600 mb-6 text-left">
              <div className="flex justify-between py-1">
                <span>Total :</span>
                <span className="font-bold text-stone-900">
                  {new Intl.NumberFormat('fr-FR').format(orderConfirmation.order.total)} {currency}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span>Mode :</span>
                <span className="font-semibold text-stone-900">
                  {orderConfirmation.order.delivery_method === 'delivery' ? 'Livraison' : 'À emporter'}
                </span>
              </div>
            </div>

            {orderConfirmation.whatsappUrl && (
              <a
                href={orderConfirmation.whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 mb-3 shadow-md shadow-emerald-600/20 text-xs sm:text-sm"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Ouvrir la discussion WhatsApp</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              onClick={() => setOrderConfirmation(null)}
              className="w-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-3 rounded-xl transition-all text-xs cursor-pointer"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
