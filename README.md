# Savora

Plateforme de commande et de gestion de restaurant : carte publique, panier, commande
WhatsApp, espace client, dashboard staff (commandes, carte, codes promo, statistiques).

- **Front** : React 19 + Vite + Tailwind CSS 4
- **API** : Node.js (`node:http`), TypeScript, sans framework
- **Base** : PostgreSQL (Neon) — migrations SQL versionnées
- **Déploiement** : Vercel (site statique + fonction serverless `api/`)

## Démarrage local

```bash
npm install
cp .env.example .env      # puis renseigner DATABASE_URL, APP_SECRET, RESEND_API_KEY…
npm run migrate           # crée le schéma
npm run seed              # données de démo + comptes de test
npm run dev               # API (8787) + Vite (5173)
```

Comptes créés par `npm run seed` (démo uniquement) :

| Rôle | Email | Mot de passe |
| --- | --- | --- |
| Owner | `owner@maison-lumen.example` | `SavoraOwner!2026` |
| Client | `client@maison-lumen.example` | `SavoraClient!2026` |

> Ne lancez jamais `npm run seed` sur une base de production : il remplace les mots de passe.

## Scripts

| Commande | Rôle |
| --- | --- |
| `npm run dev` | API + front en parallèle |
| `npm run dev:api` / `npm run dev:web` | un seul service |
| `npm run build` | build du front (`dist/`) |
| `npm run typecheck` | TypeScript front + serveur |
| `npm test` | tests unitaires (`node:test`) |
| `npm run lint` | Oxlint |
| `npm run migrate` / `npm run seed` | base de données |

## Variables d'environnement

Voir `.env.example`. En production, `NODE_ENV=production` et `APP_URL` doivent être
définis, sinon `/api/health` répond `503` avec `config: "incomplete"`.

- `DATABASE_URL` — connexion PostgreSQL (Neon), SSL exigé hors localhost
- `APP_SECRET` — au moins 32 caractères (chiffrement TOTP, hachage IP)
- `APP_URL` — URL publique HTTPS (CORS, redirections OAuth, liens e-mail)
- `RESEND_API_KEY` / `EMAIL_FROM` — e-mails transactionnels (SMTP possible en secours)
- `GOOGLE_CLIENT_ID` / `SECRET` / `REDIRECT_URI` — connexion Google
- `PAYGATE_API_TOKEN` — paiement Flooz / T-Money (voir ci-dessous)

## Déploiement sur Vercel

1. Importer le dépôt dans Vercel (framework détecté : **Vite**).
2. Renseigner les variables d'environnement (Production **et** Preview) :
   `NODE_ENV=production`, `APP_URL=https://<projet>.vercel.app`, `DATABASE_URL`,
   `APP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_*`, `PAYGATE_API_TOKEN`.
3. Appliquer les migrations sur la base distante **depuis votre machine** :
   `npm run migrate` (le build Vercel ne touche pas à la base).
4. Déployer. Le front est servi depuis `dist/`, et `api/[...path].ts` expose toutes
   les routes `/api/*` dans une fonction serverless (aucun port ouvert).
5. Vérifier `https://<projet>.vercel.app/api/health` → `200 {"status":"ok","db":"ok","config":"ok"}`.
6. Pour Google OAuth :
   - `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET` suffisent. `GOOGLE_REDIRECT_URI`
     peut rester vide : l'URI est déduite de `APP_URL` (ou du domaine Vercel).
   - Dans Google Cloud Console → **APIs & Services → Credentials → OAuth client**,
     ajouter dans **Authorized redirect URIs** :
     `https://<projet>.vercel.app/api/auth/google/callback`
     (et `http://localhost:8787/api/auth/google/callback` pour le développement).
   - Si l'écran de consentement est en mode **Testing**, ajouter votre adresse
     dans **Test users**, sinon Google refuse la connexion.

### Limitations serverless

- Le flux SSE `/api/events` n'est pas utilisé : le front se rafraîchit par polling
  (`usePolling`). Sur Vercel, une connexion longue serait coupée de toute façon.
- Le rate-limit en mémoire est propre à chaque instance ; les tentatives de connexion
  sont, elles, comptées en base (`login_attempts`).
- `/api/payments/initiate` exige une session (client propriétaire de la commande ou staff).
  `/api/payments/status` accepte le webhook PayGate avec le jeton partagé
  (`PAYGATE_API_TOKEN`, corps `auth_token`/`token` ou en-tête `x-paygate-token`)
  ou un membre du staff authentifié. Configurez l'URL de webhook côté PayGate.

## Structure

```
api/[...path].ts      point d'entrée serverless → serveur HTTP
server/index.ts       routes API + serveur
server/context.ts     session, permissions, CSRF
server/lib/           crypto, db, http, mail, pricing, rate-limit, config, health
database/migrations/  schéma SQL (001 → 009)
src/                  application React
tests/                tests unitaires
```
