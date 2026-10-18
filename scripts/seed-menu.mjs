import pg from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/DATABASE_URL=(.*)/);
const isLocal = match[1].includes("localhost") || match[1].includes("127.0.0.1");
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: isLocal ? false : { rejectUnauthorized: true },
});

await client.connect();

const rest = await client.query('SELECT id FROM restaurants LIMIT 1');
const restId = rest.rows[0].id;

const catsCount = await client.query('SELECT count(*) FROM categories');
if (Number(catsCount.rows[0].count) === 0) {
  const c1 = await client.query(
    'INSERT INTO categories (restaurant_id, name, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
    [restId, 'Entrées', 'Petites assiettes pour ouvrir le repas.', 1]
  );
  const c2 = await client.query(
    'INSERT INTO categories (restaurant_id, name, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
    [restId, 'Plats', 'Le cœur du four et de la plancha.', 2]
  );
  const c3 = await client.query(
    'INSERT INTO categories (restaurant_id, name, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
    [restId, 'Desserts', 'Pâtisserie artisanale et douceurs.', 3]
  );
  const c4 = await client.query(
    'INSERT INTO categories (restaurant_id, name, description, position) VALUES ($1, $2, $3, $4) RETURNING id',
    [restId, 'Boissons', 'Cave courte et rafraîchissements.', 4]
  );

  const plats = [
    { cat: c1.rows[0].id, name: 'Tartare de betterave et chèvre fumé', desc: 'Betterave rôtie, chèvre fumé, noisettes, vinaigre de cidre.', price: 12.00, pop: true, pos: 1 },
    { cat: c1.rows[0].id, name: 'Velouté de poireau, huile de pain grillé', desc: 'Poireaux de saison, croûtons, citron confit.', price: 9.50, pop: false, pos: 2 },
    { cat: c2.rows[0].id, name: 'Poulet rôti fermier, jus aux herbes', desc: 'Cuisse rôtie dorée, pommes grenaille, salade croquante.', price: 21.00, pop: true, pos: 1 },
    { cat: c2.rows[0].id, name: 'Cabillaud poêlé, beurre blanc et poireaux', desc: 'Filet de cabillaud frais, fondue de poireaux, émulsion citron.', price: 24.00, pop: true, pos: 2 },
    { cat: c2.rows[0].id, name: 'Risotto d épeautre aux cèpes', desc: 'Épeautre fondant, cèpes poêlés, parmesan affiné, persil plat.', price: 19.00, pop: false, pos: 3 },
    { cat: c3.rows[0].id, name: 'Tarte sablée au chocolat noir intense', desc: 'Cacao grand cru, ganache onctueuse, touche de fleur de sel.', price: 9.00, pop: true, pos: 1 },
    { cat: c3.rows[0].id, name: 'Fromage blanc artisanal, miel & noix', desc: 'Ferme locale, miel de fleurs sauvages et cerneaux de noix.', price: 7.50, pop: false, pos: 2 },
    { cat: c4.rows[0].id, name: 'Citronnade maison à la menthe fraîche', desc: 'Citrons pressés, menthe du jardin, sirop pur canne.', price: 4.50, pop: true, pos: 1 },
    { cat: c4.rows[0].id, name: 'Cuvée Rouge Maison (Verre 12cl)', desc: 'Syrah & grenache bio, rondeur et tanins soyeux.', price: 6.50, pop: false, pos: 2 },
  ];

  for (const p of plats) {
    const platRes = await client.query(
      'INSERT INTO plats (restaurant_id, category_id, name, description, price, is_available, is_popular, position) VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id',
      [restId, p.cat, p.name, p.desc, p.price, p.pop, p.pos]
    );
    await client.query(
      'INSERT INTO stock (restaurant_id, plat_id, quantity, minimum_quantity) VALUES ($1, $2, 50, 10) ON CONFLICT DO NOTHING',
      [restId, platRes.rows[0].id]
    );
  }

  // Insert promo
  await client.query(
    'INSERT INTO promotions (restaurant_id, name, code, type, value, start_date, end_date, is_active) VALUES ($1, $2, $3, $4, $5, now() - interval \'1 day\', now() + interval \'60 days\', true) ON CONFLICT DO NOTHING',
    [restId, 'Offre Découverte', 'BIENVENUE10', 'percent', 10]
  );

  console.log('Seed completed successfully with categories, dishes, stock, and promo!');
} else {
  console.log('Categories already present');
}

await client.end();
