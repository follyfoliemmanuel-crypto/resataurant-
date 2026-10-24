-- Photos importées pour les plats.
-- Les fichiers sont stockés dans Neon (BYTEA), comme les PDF de rapports :
-- aucun fichier sur le disque éphémère des fonctions Vercel.
-- Le client compresse l'image avant l'envoi ; le serveur vérifie ensuite
-- le type MIME, la taille et la signature binaire avant insertion.

CREATE TABLE IF NOT EXISTS plat_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  ),
  data BYTEA NOT NULL CHECK (octet_length(data) > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plat_images_restaurant
  ON plat_images(restaurant_id, created_at DESC);
