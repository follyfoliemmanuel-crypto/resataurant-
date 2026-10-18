import React, { useState, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { useServerEvents } from '../hooks/useServerEvents';
import {
  X, LogOut, TrendingUp, ShoppingBag,
  Plus, AlertCircle, ImageIcon, Utensils, UserCheck,
  Tag, Search, Edit2, Trash2, Check, ArrowLeft, KeyRound
} from 'lucide-react';
import type { AuthUser, DashboardStats, Order, Category, Plat, Promotion } from '../types';
import {
  login, register, verifyCode, logout, fetchAdminStats, fetchAdminOrders,
  updateOrderStatus, createPlat, deletePlat,
  requestPasswordReset, resetPassword, resendVerification,
  fetchAdminPromotions, createAdminPromotion, updateAdminPromotion, deleteAdminPromotion
} from '../api';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  onUserChange: (user: AuthUser | null) => void;
  categories: Category[];
  plats: Plat[];
  onRefreshMenu: () => void;
  currency: string;
  initialMode?: 'login' | 'register' | 'forgot' | 'reset';
  resetToken?: string | null;
}

export const AdminModal: React.FC<AdminModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserChange,
  categories,
  plats,
  onRefreshMenu,
  currency,
  initialMode = 'login',
  resetToken = null,
}) => {
  const [tab, setTab] = useState<'stats' | 'orders' | 'menu' | 'promos'>('stats');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot' | 'reset'>(initialMode);

  // Auth fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [registerSuccessMsg, setRegisterSuccessMsg] = useState<{ msg: string; devLink?: string; devCode?: string } | null>(null);
  const [verifyCodeInput, setVerifyCodeInput] = useState('');

  // Password Reset fields
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [devResetLink, setDevResetLink] = useState<string | undefined>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  // Stats, Orders & Promos
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [promoSearch, setPromoSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  // Promo form modal state
  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Partial<Promotion> | null>(null);
  const [promoFormError, setPromoFormError] = useState('');
  const [isSavingPromo, setIsSavingPromo] = useState(false);

  // New Plat Form (with photo URL)
  const [newPlatName, setNewPlatName] = useState('');
  const [newPlatCat, setNewPlatCat] = useState('');
  const [newPlatPrice, setNewPlatPrice] = useState('');
  const [newPlatDesc, setNewPlatDesc] = useState('');
  const [newPlatImage, setNewPlatImage] = useState('');
  const [newPlatPopular, setNewPlatPopular] = useState(false);
  const [creatingPlat, setCreatingPlat] = useState(false);

  useEffect(() => {
    setAuthMode(initialMode);
  }, [initialMode, isOpen]);

  useEffect(() => {
    if (resetToken) {
      setAuthMode('reset');
    }
  }, [resetToken]);

  useEffect(() => {
    if (isOpen && currentUser && currentUser.role !== 'customer') {
      loadAdminData();
    }
    if (categories.length > 0 && !newPlatCat) {
      setNewPlatCat(categories[0].id);
    }
  }, [isOpen, currentUser, categories]);

  const loadAdminData = async (silent = false) => {
    if (!silent) setLoadingData(true);
    const [statsRes, ordersRes, promosRes] = await Promise.all([
      fetchAdminStats(),
      fetchAdminOrders(),
      fetchAdminPromotions(),
    ]);
    if (statsRes) setStats(prev => (JSON.stringify(prev) === JSON.stringify(statsRes) ? prev : statsRes));
    if (ordersRes) setOrders(prev => (JSON.stringify(prev) === JSON.stringify(ordersRes) ? prev : ordersRes));
    if (promosRes) setPromotions(prev => (JSON.stringify(prev) === JSON.stringify(promosRes) ? prev : promosRes));
    if (!silent) setLoadingData(false);
  };

  usePolling(() => loadAdminData(true), 5_000, isOpen && !!currentUser && currentUser.role !== 'customer');
  useServerEvents(() => loadAdminData(true), isOpen && !!currentUser && currentUser.role !== 'customer');

  if (!isOpen) return null;

  const toNum = (v: unknown) => Number(v) || 0;
  const summary = {
    totalOrders: Math.max(toNum(stats?.summary?.total_orders), orders.length),
    pendingOrders: Math.max(toNum(stats?.summary?.pending_orders), orders.filter(o => o.status === 'pending').length),
    deliveredOrders: Math.max(toNum(stats?.summary?.delivered_orders), orders.filter(o => o.status === 'delivered').length),
    revenue: Math.max(toNum(stats?.summary?.total_revenue), orders.reduce((sum, o) => sum + toNum(o.total), 0)),
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);
    const res = await login(email, password);
    setIsAuthLoading(false);
    if (res.success && res.user) {
      onUserChange(res.user);
      setPassword('');
    } else {
      setAuthError(res.error || 'Erreur de connexion.');
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setRegisterSuccessMsg(null);
    if (!password || password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setAuthError('Le mot de passe doit comporter au moins 12 caractères, avec majuscule, minuscule et chiffre.');
      return;
    }
    setIsAuthLoading(true);
    const accountPassword = password;
    const res = await register(name, email, accountPassword);
    setIsAuthLoading(false);
    if (res.success) {
      if (res.requiresVerification) {
        setRegisterSuccessMsg({
          msg: res.message || "Un e-mail de confirmation vous a été envoyé. Veuillez cliquer sur le lien pour activer votre compte.",
          devLink: res.devVerificationLink,
          devCode: res.devVerificationCode,
        });
        setVerifyCodeInput('');
      } else if (res.user) {
        onUserChange(res.user);
        setPassword('');
        setName('');
      }
    } else {
      setAuthError(res.error || 'Erreur lors de l’inscription.');
    }
  };

  const handleVerifyCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);
    const res = await verifyCode(email, verifyCodeInput, password);
    setIsAuthLoading(false);
    if (res.success && res.user) {
      onUserChange(res.user);
      setRegisterSuccessMsg(null);
      setVerifyCodeInput('');
      setPassword('');
      setName('');
    } else {
      setAuthError(res.error || 'Code incorrect ou expiré.');
    }
  };

  const handleResendCode = async () => {
    setAuthError('');
    setIsAuthLoading(true);
    const res = await resendVerification(email);
    setIsAuthLoading(false);
    if (res.success) {
      setRegisterSuccessMsg({
        msg: res.message || 'Nouveau code envoyé.',
        devLink: res.devVerificationLink,
        devCode: res.devVerificationCode
      });
      setVerifyCodeInput('');
    } else {
      setAuthError(res.error || 'Impossible de renvoyer le code.');
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsAuthLoading(true);
    const res = await requestPasswordReset(email);
    setIsAuthLoading(false);
    if (res.success) {
      setForgotSubmitted(true);
      setForgotMsg(res.message || "Si un compte est associé à cette adresse, un e-mail a été envoyé.");
      setDevResetLink(res.devResetLink);
    } else {
      setAuthError(res.error || "Une erreur est survenue lors de la demande.");
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!resetToken) {
      setAuthError("Jeton de réinitialisation manquant ou invalide.");
      return;
    }
    if (newPassword.length < 6) {
      setAuthError("Le mot de passe doit comporter au moins 6 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setAuthError("Les mots de passe ne correspondent pas.");
      return;
    }

    setIsAuthLoading(true);
    const res = await resetPassword(resetToken, newPassword);
    setIsAuthLoading(false);
    if (res.success) {
      setResetSuccess(true);
    } else {
      setAuthError(res.error || "Impossible de réinitialiser le mot de passe.");
    }
  };

  const handleLogout = async () => {
    await logout();
    onUserChange(null);
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    const success = await updateOrderStatus(orderId, newStatus);
    if (success) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus as any } : o));
      void loadAdminData(true);
    }
  };

  const handleCreatePlat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlatName || !newPlatPrice || !newPlatCat) return;
    setCreatingPlat(true);
    const success = await createPlat({
      categoryId: newPlatCat,
      name: newPlatName.trim(),
      description: newPlatDesc.trim(),
      price: Number(newPlatPrice),
      imageUrl: newPlatImage.trim() || undefined,
      isAvailable: true,
      isPopular: newPlatPopular,
    });
    setCreatingPlat(false);
    if (success) {
      setNewPlatName('');
      setNewPlatPrice('');
      setNewPlatDesc('');
      setNewPlatImage('');
      setNewPlatPopular(false);
      onRefreshMenu();
    }
  };

  const handleDeletePlat = async (id: string) => {
    if (window.confirm('Voulez-vous supprimer ce plat de la carte ?')) {
      await deletePlat(id);
      onRefreshMenu();
    }
  };

  // Promo Handlers
  const handleOpenCreatePromo = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    setEditingPromo({
      code: '',
      name: '',
      type: 'percent',
      value: 10,
      min_order_amount: null,
      max_uses: null,
      max_uses_per_user: 1,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: nextYear.toISOString().slice(0, 10),
      is_active: true,
    });
    setPromoFormError('');
    setIsPromoModalOpen(true);
  };

  const handleOpenEditPromo = (promo: Promotion) => {
    setEditingPromo({
      ...promo,
      start_date: promo.start_date.slice(0, 10),
      end_date: promo.end_date.slice(0, 10),
    });
    setPromoFormError('');
    setIsPromoModalOpen(true);
  };

  const handleSavePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPromo) return;
    setPromoFormError('');
    setIsSavingPromo(true);

    if (editingPromo.id) {
      // Edit
      const res = await updateAdminPromotion(editingPromo.id, editingPromo);
      setIsSavingPromo(false);
      if (res.success && res.promotion) {
        setIsPromoModalOpen(false);
        setEditingPromo(null);
        void loadAdminData(true);
      } else {
        setPromoFormError(res.error || "Erreur lors de la mise à jour.");
      }
    } else {
      // Create
      const res = await createAdminPromotion(editingPromo);
      setIsSavingPromo(false);
      if (res.success && res.promotion) {
        setIsPromoModalOpen(false);
        setEditingPromo(null);
        void loadAdminData(true);
      } else {
        setPromoFormError(res.error || "Erreur lors de la création.");
      }
    }
  };

  const handleTogglePromoActive = async (promo: Promotion) => {
    const updated = await updateAdminPromotion(promo.id, { is_active: !promo.is_active });
    if (updated.success) {
      void loadAdminData(true);
    }
  };

  const handleDeletePromo = async (id: string) => {
    if (window.confirm("Êtes-vous sûr de vouloir supprimer ce code promo ?")) {
      const ok = await deleteAdminPromotion(id);
      if (ok) {
        void loadAdminData(true);
      }
    }
  };

  const formatMoney = (val: string | number) =>
    new Intl.NumberFormat('fr-FR').format(Number(val));

  const filteredPromos = promotions.filter(p =>
    p.code.toLowerCase().includes(promoSearch.toLowerCase()) ||
    p.name.toLowerCase().includes(promoSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-900 text-white">
          <div className="flex items-center gap-3">
            <img
              src="/logo-savora-sm.png"
              alt="Savora"
              width={40}
              height={40}
              className="w-10 h-10 rounded-lg bg-white object-contain p-0.5 shrink-0"
            />
            <div>
              <h2 className="font-bold text-base leading-tight">Espace Personnel Savora</h2>
              <p className="text-xs text-stone-400">
                {currentUser ? `Bienvenue, ${currentUser.name} (${currentUser.role})` : 'Connexion & Inscription'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentUser && (
              <button
                onClick={handleLogout}
                className="text-stone-400 hover:text-white p-2 rounded-lg hover:bg-stone-800 transition-colors cursor-pointer"
                title="Se déconnecter"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-stone-400 hover:text-white p-2 rounded-lg hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* NOT LOGGED IN VIEWS */}
        {!currentUser ? (
          <div className="p-8 max-w-md mx-auto w-full my-auto">
            {/* RESET PASSWORD MODE */}
            {authMode === 'reset' ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto mb-2">
                    <KeyRound className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-stone-900">Nouveau mot de passe</h3>
                  <p className="text-xs text-stone-500">Saisissez votre nouveau mot de passe sécurisé.</p>
                </div>

                {authError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                {resetSuccess ? (
                  <div className="text-center space-y-4 py-4">
                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                      <Check className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-emerald-800">
                      Votre mot de passe a été modifié avec succès !
                    </p>
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setResetSuccess(false); }}
                      className="w-full bg-stone-900 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer"
                    >
                      Se connecter
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Nouveau mot de passe</label>
                      <input
                        type="password"
                        required
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        placeholder="Au moins 6 caractères"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Confirmer le mot de passe</label>
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="Retapez le mot de passe"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAuthLoading}
                      className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isAuthLoading ? 'Enregistrement...' : 'Enregistrer le mot de passe'}
                    </button>
                  </form>
                )}
              </div>
            ) : authMode === 'forgot' ? (
              /* FORGOT PASSWORD MODE */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); setForgotSubmitted(false); }}
                  className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-900 cursor-pointer mb-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Retour à la connexion</span>
                </button>

                <div className="text-center">
                  <h3 className="text-lg font-bold text-stone-900">Mot de passe oublié</h3>
                  <p className="text-xs text-stone-500">
                    Entrez votre adresse email pour recevoir un lien de réinitialisation.
                  </p>
                </div>

                {authError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                {forgotSubmitted ? (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs space-y-3 text-center">
                    <p className="font-semibold">{forgotMsg}</p>
                    {devResetLink && (
                      <p className="text-stone-600 text-xs mt-2 border-t border-emerald-200 pt-2">
                        Mode dev : <a href={devResetLink} className="underline text-orange-600 font-bold">Lien direct de réinitialisation</a>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setForgotSubmitted(false); }}
                      className="inline-block mt-2 px-4 py-2 bg-stone-900 text-white rounded-xl font-semibold text-xs cursor-pointer"
                    >
                      Retour à la connexion
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Adresse email</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="votre-email@example.com"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAuthLoading}
                      className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isAuthLoading ? 'Envoi...' : 'Envoyer le lien de réinitialisation'}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              /* LOGIN & REGISTER MODES */
              <div>
                {/* Tabs Connexion / Inscription */}
                <div className="flex bg-stone-100 p-1 rounded-2xl mb-6">
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${authMode === 'login'
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-500 hover:text-stone-900'
                      }`}
                  >
                    Se connecter
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('register'); setAuthError(''); setRegisterSuccessMsg(null); }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${authMode === 'register'
                      ? 'bg-white text-stone-900 shadow-sm'
                      : 'text-stone-500 hover:text-stone-900'
                      }`}
                  >
                    S'inscrire
                  </button>
                </div>

                {/* Google Sign-in Button */}
                <a
                  href="/api/auth/google"
                  className="w-full flex items-center justify-center gap-3 bg-white hover:bg-stone-50 text-stone-800 font-semibold py-2.5 px-4 rounded-xl border border-stone-300 shadow-xs transition-all text-sm mb-4 cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continuer avec Google</span>
                </a>

                <div className="relative flex py-2 items-center mb-4">
                  <div className="flex-grow border-t border-stone-200"></div>
                  <span className="flex-shrink mx-3 text-stone-400 text-xs uppercase font-medium">ou par email</span>
                  <div className="flex-grow border-t border-stone-200"></div>
                </div>

                {authError && (
                  <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{authError}</span>
                  </div>
                )}

                {authMode === 'register' && registerSuccessMsg ? (
                  /* STEP 2 REGISTER: CODE CONFIRMATION */
                  <form onSubmit={handleVerifyCodeSubmit} className="space-y-4 text-center">
                    <div className="w-14 h-14 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto">
                      <UserCheck className="w-7 h-7" />
                    </div>
                    <p className="text-sm text-stone-700">{registerSuccessMsg.msg}</p>
                    {registerSuccessMsg.devCode && (
                      <p className="text-xs text-stone-500">
                        Mode test (e-mails non configurés) : votre code est <strong className="tracking-widest">{registerSuccessMsg.devCode}</strong>
                      </p>
                    )}
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={verifyCodeInput}
                      onChange={e => setVerifyCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      aria-label="Code de confirmation à 6 chiffres"
                      className="w-full text-center text-2xl tracking-[0.5em] font-bold border border-stone-300 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    <button
                      type="submit"
                      disabled={isAuthLoading || verifyCodeInput.length !== 6}
                      className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-all cursor-pointer"
                    >
                      {isAuthLoading ? 'Vérification…' : 'Valider mon compte'}
                    </button>
                    {registerSuccessMsg.devLink && (
                      <a href={registerSuccessMsg.devLink} className="block text-xs font-semibold text-orange-600 hover:text-orange-500">
                        Ou confirmer via le lien (mode test)
                      </a>
                    )}
                    <div className="flex items-center justify-center gap-4 text-xs font-semibold text-stone-500">
                      <button type="button" onClick={handleResendCode} disabled={isAuthLoading} className="hover:text-stone-900 cursor-pointer disabled:opacity-50">
                        Renvoyer le code
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRegisterSuccessMsg(null); setAuthError(''); setVerifyCodeInput(''); }}
                        className="hover:text-stone-900 cursor-pointer"
                      >
                        Modifier mes informations
                      </button>
                    </div>
                  </form>
                ) : authMode === 'login' ? (
                  /* LOGIN FORM */
                  <form onSubmit={handleLoginSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Email</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-stone-700">Mot de passe</label>
                        <button
                          type="button"
                          onClick={() => { setAuthMode('forgot'); setAuthError(''); }}
                          className="text-xs text-orange-600 hover:text-orange-500 font-semibold cursor-pointer"
                        >
                          Mot de passe oublié ?
                        </button>
                      </div>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isAuthLoading}
                      className="w-full bg-orange-600 hover:bg-orange-500 text-white font-semibold py-3 rounded-xl text-sm transition-all shadow-md shadow-orange-600/20 disabled:opacity-50 cursor-pointer"
                    >
                      {isAuthLoading ? 'Connexion en cours...' : 'Se connecter'}
                    </button>
                  </form>
                ) : (
                  /* REGISTER FORM */
                  <form onSubmit={handleRegisterSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Nom complet</label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Ex: Paul Martin"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Adresse Email</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="Ex: paul@example.com"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-stone-700 mb-1">Mot de passe</label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Au moins 6 caractères"
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-hidden focus:border-orange-500"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isAuthLoading}
                      className="w-full bg-stone-900 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl text-sm transition-all shadow-md disabled:opacity-50 cursor-pointer"
                    >
                      {isAuthLoading ? 'Création du compte...' : 'Créer mon compte'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        ) : currentUser.role === 'customer' ? (
          /* SIMPLE CLIENT PROFILE VIEW */
          <div className="p-8 max-w-md mx-auto w-full my-auto text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <UserCheck className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-stone-900">Bienvenue, {currentUser.name} !</h3>
            <p className="text-xs text-stone-500">
              Votre compte client est actif ({currentUser.email}). Vous pouvez commander en toute simplicité et profiter de nos offres exclusives.
            </p>
            <div className="pt-4">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Découvrir la carte
              </button>
            </div>
          </div>
        ) : (
          /* STAFF / OWNER DASHBOARD */
          <div className="flex-1 flex flex-col min-h-0">
            {/* Tabs Bar */}
            <div className="flex border-b border-stone-200 bg-stone-50 px-6 gap-2 overflow-x-auto">
              <button
                onClick={() => setTab('stats')}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${tab === 'stats'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Statistiques</span>
              </button>
              <button
                onClick={() => setTab('orders')}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${tab === 'orders'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Commandes ({orders.length})</span>
              </button>
              <button
                onClick={() => setTab('menu')}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${tab === 'menu'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
              >
                <Utensils className="w-4 h-4" />
                <span>Gestion de la carte & Photos</span>
              </button>
              <button
                onClick={() => setTab('promos')}
                className={`py-3 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${tab === 'promos'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
                  }`}
              >
                <Tag className="w-4 h-4" />
                <span>Codes promo ({promotions.length})</span>
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto p-6 bg-stone-50/50">
              {loadingData ? (
                <div className="text-center py-12 text-stone-400 text-sm">
                  Chargement des données...
                </div>
              ) : tab === 'stats' ? (
                <div className="space-y-6">
                  {/* Summary metric cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
                      <p className="text-xs font-medium text-stone-500">Chiffre d'affaires</p>
                      <p className="text-xl font-black text-stone-900 mt-1">
                        {formatMoney(summary.revenue)} <span className="text-xs font-semibold text-stone-500">{currency}</span>
                      </p>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
                      <p className="text-xs font-medium text-stone-500">Total Commandes</p>
                      <p className="text-xl font-black text-stone-900 mt-1">{summary.totalOrders}</p>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
                      <p className="text-xs font-medium text-stone-500">En attente / Cuisine</p>
                      <p className="text-xl font-black text-amber-600 mt-1">{summary.pendingOrders}</p>
                    </div>

                    <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
                      <p className="text-xs font-medium text-stone-500">Livrées avec succès</p>
                      <p className="text-xl font-black text-emerald-600 mt-1">{summary.deliveredOrders}</p>
                    </div>
                  </div>

                  {/* Top plats */}
                  {stats?.popularPlats && stats.popularPlats.length > 0 && (
                    <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
                      <h4 className="font-bold text-sm text-stone-900 mb-3">Plats les plus commandés</h4>
                      <div className="space-y-2">
                        {stats.popularPlats.map((p, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs py-1.5 border-b border-stone-100 last:border-0">
                            <span className="font-medium text-stone-800">{p.name}</span>
                            <div className="flex gap-4 text-stone-500">
                              <span><strong>{p.total_sold}</strong> vendus</span>
                              <span className="font-semibold text-stone-900">{formatMoney(p.total_revenue)} {currency}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : tab === 'orders' ? (
                /* ORDERS TAB */
                <div className="space-y-4">
                  {orders.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-sm">
                      Aucune commande pour le moment.
                    </div>
                  ) : (
                    orders.map(order => (
                      <div key={order.id} className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
                          <div>
                            <span className="font-mono font-bold text-sm text-stone-900">#{order.order_number}</span>
                            <span className="text-xs text-stone-400 ml-2">
                              {new Date(order.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${order.status === 'confirmed' ? 'bg-amber-100 text-amber-800' :
                              order.status === 'preparing' ? 'bg-blue-100 text-blue-800' :
                                order.status === 'ready' ? 'bg-purple-100 text-purple-800' :
                                  order.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' :
                                    order.status === 'cancelled' ? 'bg-rose-100 text-rose-800' :
                                      'bg-stone-100 text-stone-700'
                              }`}>
                              {order.status}
                            </span>

                            <select
                              value={order.status}
                              onChange={e => handleStatusChange(order.id, e.target.value)}
                              className="text-xs bg-stone-50 border border-stone-200 rounded-lg px-2 py-1 cursor-pointer font-medium"
                            >
                              <option value="pending">En attente</option>
                              <option value="confirmed">Confirmée</option>
                              <option value="preparing">En préparation</option>
                              <option value="ready">Prête</option>
                              <option value="delivering">En livraison</option>
                              <option value="delivered">Livrée</option>
                              <option value="cancelled">Annulée</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-stone-400 block">Client</span>
                            <span className="font-semibold text-stone-800">{order.client_name || 'Client direct'}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block">Téléphone</span>
                            <span className="font-semibold text-stone-800">{order.client_phone || '—'}</span>
                          </div>
                          <div>
                            <span className="text-stone-400 block">Mode</span>
                            <span className="font-semibold text-stone-800">
                              {order.delivery_method === 'delivery' ? 'Livraison' : 'À emporter'}
                            </span>
                          </div>
                          <div>
                            <span className="text-stone-400 block">Total</span>
                            <span className="font-bold text-orange-600">{formatMoney(order.total)} {currency}</span>
                          </div>
                        </div>

                        {order.delivery_address && (
                          <div className="text-xs bg-stone-50 p-2.5 rounded-xl border border-stone-100 text-stone-600">
                            <strong>Adresse :</strong> {order.delivery_address}
                          </div>
                        )}
                        {order.note && (
                          <div className="text-xs bg-amber-50 p-2.5 rounded-xl border border-amber-100 text-amber-800">
                            <strong>Note :</strong> {order.note}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : tab === 'promos' ? (
                /* PROMOTIONS TAB */
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-2xl border border-stone-200 shadow-xs">
                    <div className="relative flex-1 w-full sm:max-w-xs">
                      <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Rechercher un code..."
                        value={promoSearch}
                        onChange={e => setPromoSearch(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-9 pr-3 py-1.5 text-xs focus:outline-hidden focus:border-orange-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenCreatePromo}
                      className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Nouveau code promo</span>
                    </button>
                  </div>

                  {filteredPromos.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-sm bg-white rounded-2xl border border-stone-200">
                      Aucun code promo trouvé.
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {filteredPromos.map(promo => {
                        const now = new Date();
                        const isExpired = new Date(promo.end_date) < now;
                        const isFuture = new Date(promo.start_date) > now;
                        const isExhausted = promo.max_uses != null && promo.uses_count >= promo.max_uses;

                        let statusBadge = (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                            Actif
                          </span>
                        );
                        if (!promo.is_active) {
                          statusBadge = (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-stone-100 text-stone-600">
                              Désactivé
                            </span>
                          );
                        } else if (isExpired) {
                          statusBadge = (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                              Expiré
                            </span>
                          );
                        } else if (isFuture) {
                          statusBadge = (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                              À venir
                            </span>
                          );
                        } else if (isExhausted) {
                          statusBadge = (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                              Épuisé
                            </span>
                          );
                        }

                        return (
                          <div
                            key={promo.id}
                            className={`p-4 rounded-2xl border bg-white shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 ${!promo.is_active ? 'opacity-70 bg-stone-50/50' : ''
                              }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-base font-black text-stone-900 tracking-wider">
                                  {promo.code}
                                </span>
                                {statusBadge}
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-100">
                                  {promo.type === 'percent' ? `-${promo.value}%` : `-${formatMoney(promo.value)} ${currency}`}
                                </span>
                              </div>
                              <p className="text-xs text-stone-600 font-medium">{promo.name}</p>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400 pt-1">
                                <span>
                                  Utilisations : <strong className="text-stone-700">{promo.uses_count}</strong>
                                  {promo.max_uses ? ` / ${promo.max_uses}` : ' (illimité)'}
                                </span>
                                {promo.min_order_amount && (
                                  <span>
                                    Min. commande : <strong className="text-stone-700">{formatMoney(promo.min_order_amount)} {currency}</strong>
                                  </span>
                                )}
                                <span>
                                  Validité : {new Date(promo.start_date).toLocaleDateString('fr-FR')} → {new Date(promo.end_date).toLocaleDateString('fr-FR')}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-end md:self-center">
                              <button
                                type="button"
                                onClick={() => handleTogglePromoActive(promo)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer border transition-colors ${promo.is_active
                                  ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                                  }`}
                              >
                                {promo.is_active ? 'Désactiver' : 'Activer'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditPromo(promo)}
                                className="p-1.5 text-stone-400 hover:text-stone-800 rounded-lg hover:bg-stone-100 cursor-pointer"
                                title="Modifier"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePromo(promo.id)}
                                className="p-1.5 text-stone-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                                title="Supprimer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* MENU TAB */
                <div className="space-y-6">
                  {/* Form to add a new dish */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
                    <h4 className="font-bold text-sm text-stone-900 mb-3 flex items-center gap-2">
                      <Plus className="w-4 h-4 text-orange-600" />
                      <span>Ajouter un plat à la carte</span>
                    </h4>

                    <form onSubmit={handleCreatePlat} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">Nom du plat</label>
                        <input
                          type="text"
                          required
                          value={newPlatName}
                          onChange={e => setNewPlatName(e.target.value)}
                          placeholder="Ex: Brochettes de bœuf grillé"
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">Catégorie</label>
                        <select
                          value={newPlatCat}
                          onChange={e => setNewPlatCat(e.target.value)}
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                        >
                          {categories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1">Prix ({currency})</label>
                        <input
                          type="number"
                          required
                          value={newPlatPrice}
                          onChange={e => setNewPlatPrice(e.target.value)}
                          placeholder="Ex: 4500"
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-stone-700 mb-1 flex items-center gap-1">
                          <ImageIcon className="w-3.5 h-3.5 text-stone-500" />
                          <span>Lien URL de la Photo</span>
                        </label>
                        <input
                          type="url"
                          value={newPlatImage}
                          onChange={e => setNewPlatImage(e.target.value)}
                          placeholder="https://images.unsplash.com/..."
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <input
                          type="checkbox"
                          id="pop"
                          checked={newPlatPopular}
                          onChange={e => setNewPlatPopular(e.target.checked)}
                          className="rounded-sm"
                        />
                        <label htmlFor="pop" className="font-semibold text-stone-700 cursor-pointer">
                          Mettre en avant comme "Populaire"
                        </label>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block font-semibold text-stone-700 mb-1">Description</label>
                        <textarea
                          rows={2}
                          value={newPlatDesc}
                          onChange={e => setNewPlatDesc(e.target.value)}
                          placeholder="Détail des saveurs, accompagnements et garniture..."
                          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                        />
                      </div>
                      <div className="sm:col-span-2 text-right">
                        <button
                          type="submit"
                          disabled={creatingPlat}
                          className="px-5 py-2.5 bg-stone-900 hover:bg-orange-600 text-white rounded-xl font-bold cursor-pointer transition-all"
                        >
                          {creatingPlat ? 'Ajout en cours...' : 'Ajouter à la carte'}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Existing plats list */}
                  <div className="bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
                    <h4 className="font-bold text-sm text-stone-900 mb-3">Plats actuels à la carte ({plats.length})</h4>
                    <div className="divide-y divide-stone-100 max-h-80 overflow-y-auto">
                      {plats.map(p => (
                        <div key={p.id} className="py-2.5 flex items-center justify-between text-xs gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            {p.image_url ? (
                              <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0 text-stone-400">
                                <Utensils className="w-4 h-4" />
                              </div>
                            )}
                            <div className="truncate">
                              <p className="font-bold text-stone-900 truncate">{p.name}</p>
                              <p className="text-stone-400">{formatMoney(p.price)} {currency}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeletePlat(p.id)}
                            className="text-stone-400 hover:text-rose-600 font-semibold p-1 shrink-0 cursor-pointer"
                          >
                            Supprimer
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* PROMO CREATION / EDIT MODAL */}
        {isPromoModalOpen && editingPromo && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs" onClick={() => setIsPromoModalOpen(false)} />
            <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-bold text-base text-stone-900">
                  {editingPromo.id ? 'Modifier le code promo' : 'Créer un code promo'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsPromoModalOpen(false)}
                  className="text-stone-400 hover:text-stone-700 p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {promoFormError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{promoFormError}</span>
                </div>
              )}

              <form onSubmit={handleSavePromo} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Code promo (ex. BIENVENUE10) *</label>
                  <input
                    type="text"
                    required
                    value={editingPromo.code || ''}
                    onChange={e => setEditingPromo({ ...editingPromo, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
                    placeholder="CODEUNIQUE"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 font-mono font-bold uppercase text-stone-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Nom / Description *</label>
                  <input
                    type="text"
                    required
                    value={editingPromo.name || ''}
                    onChange={e => setEditingPromo({ ...editingPromo, name: e.target.value })}
                    placeholder="Ex: Réduction nouveaux clients"
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Type de réduction</label>
                    <select
                      value={editingPromo.type || 'percent'}
                      onChange={e => setEditingPromo({ ...editingPromo, type: e.target.value as any })}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                    >
                      <option value="percent">Pourcentage (%)</option>
                      <option value="fixed">Montant fixe ({currency})</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">
                      Valeur de réduction {editingPromo.type === 'percent' ? '(%)' : `(${currency})`} *
                    </label>
                    <input
                      type="number"
                      required
                      min={0.1}
                      max={editingPromo.type === 'percent' ? 100 : undefined}
                      step="any"
                      value={editingPromo.value ?? ''}
                      onChange={e => setEditingPromo({ ...editingPromo, value: e.target.value })}
                      placeholder={editingPromo.type === 'percent' ? '10' : '1000'}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 font-bold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-stone-700 mb-1">Montant minimum de commande (optionnel)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={editingPromo.min_order_amount ?? ''}
                    onChange={e => setEditingPromo({ ...editingPromo, min_order_amount: e.target.value ? Number(e.target.value) : null })}
                    placeholder={`Montant en ${currency}`}
                    className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Nombre max. d'utilisations (total)</label>
                    <input
                      type="number"
                      min={1}
                      value={editingPromo.max_uses ?? ''}
                      onChange={e => setEditingPromo({ ...editingPromo, max_uses: e.target.value ? parseInt(e.target.value, 10) : null })}
                      placeholder="Illimité si vide"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Limite par utilisateur</label>
                    <input
                      type="number"
                      min={1}
                      value={editingPromo.max_uses_per_user ?? ''}
                      onChange={e => setEditingPromo({ ...editingPromo, max_uses_per_user: e.target.value ? parseInt(e.target.value, 10) : null })}
                      placeholder="Ex: 1"
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Date de début</label>
                    <input
                      type="date"
                      required
                      value={editingPromo.start_date || ''}
                      onChange={e => setEditingPromo({ ...editingPromo, start_date: e.target.value })}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-stone-700 mb-1">Date d'expiration</label>
                    <input
                      type="date"
                      required
                      value={editingPromo.end_date || ''}
                      onChange={e => setEditingPromo({ ...editingPromo, end_date: e.target.value })}
                      className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="promo-active-chk"
                    checked={editingPromo.is_active !== false}
                    onChange={e => setEditingPromo({ ...editingPromo, is_active: e.target.checked })}
                    className="rounded-sm"
                  />
                  <label htmlFor="promo-active-chk" className="font-semibold text-stone-700 cursor-pointer">
                    Code promo actif et applicable
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-stone-100">
                  <button
                    type="button"
                    onClick={() => setIsPromoModalOpen(false)}
                    className="px-4 py-2 border border-stone-200 rounded-xl text-stone-600 font-semibold cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingPromo}
                    className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    {isSavingPromo ? 'Enregistrement...' : editingPromo.id ? 'Mettre à jour' : 'Créer le code'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
