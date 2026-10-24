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
| Owner | `owner@maison-lumen.example` | `OWNER_PASSWORD` (variable d'environnement) |
| Client | `client@maison-lumen.example` | `CLIENT_PASSWORD` (variable d'environnement) |

Définissez les deux valeurs avant de lancer le seed :

```bash
OWNER_PASSWORD='...' CLIENT_PASSWORD='...' npm run seed
```

> Les mots de passe historiques des comptes de démonstration sont publics dans l'historique Git :
> s'ils ont déjà servi, changez-les immédiatement.

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
- `CRON_SECRET` — secret partagé protégeant l'appel Vercel Cron des rapports
  hebdomadaires (32+ caractères recommandés). Sans cette variable, le cron répond
  `503` et aucun rapport automatique n'est généré.

## Rapports hebdomadaires

Chaque lundi à **06:00 UTC**, Vercel Cron appelle
`GET /api/cron/weekly-reports`. La tâche authentifie l'appel avec
`Authorization: Bearer <CRON_SECRET>`, puis génère pour chaque restaurant actif
un PDF couvrant la semaine précédente (lundi → dimanche, bornes UTC).

- Les métadonnées et le PDF sont stockés dans Neon PostgreSQL, table
  `weekly_reports` (`file_data` en `BYTEA`). Aucun fichier n'est écrit sur le
  disque temporaire de Vercel.
- La contrainte `UNIQUE (restaurant_id, week_start)` empêche les doublons. Un
  rapport terminé n'est jamais régénéré ; un rapport en échec peut être relancé
  depuis l'onglet **Rapports hebdomadaires** du tableau de bord.
- Les téléchargements sont filtrés côté backend par `restaurant_id` et exigent
  la permission `statistics`.
- Après ajout de `CRON_SECRET` dans Vercel (Production), redéployer pour que
  Vercel Cron l'utilise. Le planning est déclaré dans `vercel.json`.
- Pour générer ou relancer manuellement la semaine précédente :
  `POST /api/admin/reports/weekly/generate` (session staff + permission
  `statistics`).

## Photos des plats

Depuis le formulaire **Ajouter un plat**, une photo peut être fournie de deux façons :

- coller une URL (`imageUrl`) ;
- choisir un fichier depuis la galerie ou le système de fichiers de l'appareil
  (`imageDataUrl`), avec redimensionnement et compression dans le navigateur.

Les fichiers importés sont stockés dans Neon, table `plat_images` (`data` en
`BYTEA`), puis servis par `GET /api/plat-images/:id`. Le serveur vérifie le type
MIME, la taille et la signature binaire ; les formats acceptés sont JPG, PNG,
WebP et GIF. Les images sont mises en cache de façon immuable.

## Déploiement sur Vercel

1. Importer le dépôt dans Vercel (framework détecté : **Vite**).
2. Renseigner les variables d'environnement (Production **et** Preview) :
   `NODE_ENV=production`, `APP_URL=https://<projet>.vercel.app`, `DATABASE_URL`,
   `APP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_*`, `PAYGATE_API_TOKEN`,
   `CRON_SECRET`.
3. Appliquer les migrations sur la base distante **depuis votre machine** :
   `npm run migrate` (le build Vercel ne touche pas à la base). Cette étape crée
   notamment les tables `weekly_reports` et `plat_images`.
4. Déployer. Le front est servi depuis `dist/`, et `api/index.ts` expose toutes
   les routes `/api/*` dans une fonction serverless (aucun port ouvert).
5. Vérifier `https://<projet>.vercel.app/api/health` → `200 {"status":"ok","db":"ok","config":"ok"}`.
6. Vérifier dans Vercel → **Settings → Cron Jobs** que
   `/api/cron/weekly-reports` est planifié (`0 6 * * 1`, lundi 06:00 UTC).
7. Pour Google OAuth :
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
database/migrations/  schéma SQL (001 → 012)
src/                  application React
tests/                tests unitaires
```
