INSERT INTO restaurants (id, slug, plan)
VALUES ('00000000-0000-4000-8000-000000000001', 'maison-lumen', 'pro')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO restaurant_settings (
  restaurant_id, restaurant_name, logo_url, description, phone, whatsapp_number,
  email, address, city, currency, primary_color, secondary_color,
  delivery_enabled, delivery_fee, opening_hours, features
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Maison Lumen',
  NULL,
  'Cuisine de quartier, produits de saison, four allumé du midi au soir. Une table parisienne conçue pour être commandée aussi bien sur place que depuis chez soi.',
  '+33 1 43 00 18 22',
  '33143001822',
  'bonjour@maison-lumen.example',
  '18 rue des Envierges',
  'Paris',
  'EUR',
  '#B8432A',
  '#2C3829',
  TRUE,
  3.50,
  '{
    "monday": {"open": "12:00", "close": "22:30"},
    "tuesday": {"open": "12:00", "close": "22:30"},
    "wednesday": {"open": "12:00", "close": "22:30"},
    "thursday": {"open": "12:00", "close": "23:00"},
    "friday": {"open": "12:00", "close": "23:00"},
    "saturday": {"open": "11:30", "close": "23:00"},
    "sunday": {"closed": true}
  }'::jsonb,
  '{"starter": true, "business": true, "pro": true}'::jsonb
)
ON CONFLICT (restaurant_id) DO NOTHING;

INSERT INTO roles (id, restaurant_id, name, permissions) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'owner', '["*"]'),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'admin', '["orders","products","categories","customers","stock","promotions","statistics","staff","notifications","settings","audit"]'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'manager', '["orders","products","categories","statistics"]'),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000001', 'cashier', '["orders"]'),
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000001', 'kitchen', '["orders:kitchen"]'),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000001', 'customer', '["account"]')
ON CONFLICT DO NOTHING;

INSERT INTO categories (id, restaurant_id, name, description, position) VALUES
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 'Entrées', 'Petites assiettes pour ouvrir le repas.', 1),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', 'Plats', 'Le cœur du four et de la plancha.', 2),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', 'Pains & accompagnements', 'Ce qui arrive à table sans qu''on le demande.', 3),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000001', 'Desserts', 'Pâtisserie de restaurant, pas de vitrine.', 4),
  ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000001', 'Boissons', 'Cave courte, choix net.', 5)
ON CONFLICT DO NOTHING;

INSERT INTO plats (id, restaurant_id, category_id, name, description, price, is_available, is_popular, position) VALUES
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Tartare de betterave et chèvre fumé', 'Betterave rôtie, chèvre fumé, noisettes, vinaigre de cidre.', 12.00, TRUE, TRUE, 1),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000021', 'Velouté de poireau, huile de pain grillé', 'Poireaux de saison, croûtons, citron confit.', 9.50, TRUE, FALSE, 2),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000022', 'Poulet rôti, jus aux herbes', 'Cuisse rôtie, pommes grenaille, salade amère.', 21.00, TRUE, TRUE, 1),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000022', 'Cabillaud, beurre blanc et poireaux', 'Filet de cabillaud, poireaux fondants, citron.', 24.00, TRUE, TRUE, 2),
  ('00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000022', 'Risotto d''épeautre aux champignons', 'Épeautre, cèpes, parmesan, persil plat.', 19.00, TRUE, FALSE, 3),
  ('00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000023', 'Pain de campagne, beurre salé', 'Levain, beurre de baratte.', 4.00, TRUE, FALSE, 1),
  ('00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000024', 'Tarte au chocolat, sel et crème fraîche', 'Cacao amer, pâte sablée, fleur de sel.', 9.00, TRUE, TRUE, 1),
  ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000024', 'Fromage blanc, miel et noix', 'Ferme d''Île-de-France, miel d''acacia.', 7.50, TRUE, FALSE, 2),
  ('00000000-0000-4000-8000-000000000039', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000025', 'Citronnade maison', 'Citrons, sucre de canne, eau pétillante.', 4.50, TRUE, FALSE, 1),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000025', 'Verre de rouge (cuvée maison)', 'Syrah / grenache, 12 cl.', 6.50, TRUE, FALSE, 2)
ON CONFLICT DO NOTHING;

INSERT INTO stock (restaurant_id, plat_id, quantity, minimum_quantity)
SELECT '00000000-0000-4000-8000-000000000001', id, 40, 8 FROM plats
WHERE restaurant_id = '00000000-0000-4000-8000-000000000001'
ON CONFLICT (plat_id) DO NOTHING;

INSERT INTO promotions (restaurant_id, name, code, type, value, start_date, end_date, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Déjeuner de semaine',
  'MIDI10',
  'percent',
  10,
  now() - interval '1 day',
  now() + interval '90 days',
  TRUE
)
ON CONFLICT DO NOTHING;
