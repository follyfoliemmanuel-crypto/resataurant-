import pg from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/DATABASE_URL=(.*)/);
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const rest = await client.query('SELECT id FROM restaurants LIMIT 1');
const restId = rest.rows[0].id;

const cats = await client.query('SELECT id, name FROM categories WHERE restaurant_id = $1 ORDER BY position', [restId]);
const catMap = {};
for (const c of cats.rows) {
  catMap[c.name] = c.id;
}

const plats = [
  { cat: catMap['Entrées'], name: 'Tartare de betterave et chèvre fumé', desc: 'Betterave rôtie, chèvre fumé, noisettes concassées, vinaigre de cidre doux.', price: 3500, pop: true, pos: 1 },
  { cat: catMap['Entrées'], name: 'Velouté de saison & croûtons dorés', desc: 'Légumes primeurs, crème infusée, croûtons à l ail et huile d olive.', price: 2800, pop: false, pos: 2 },
  { cat: catMap['Plats'], name: 'Poulet braisé façon Savora', desc: 'Cuisse fermière marinée 24h, épices douces, frites maison ou bananes plantain.', price: 6500, pop: true, pos: 1 },
  { cat: catMap['Plats'], name: 'Filet de poisson noble grillé', desc: 'Arrivage frais, émulsion agrumes & fines herbes, riz parfumé.', price: 7500, pop: true, pos: 2 },
  { cat: catMap['Plats'], name: 'Burger gourmet & confit d oignons', desc: 'Bœuf haché minute, cheddar affiné, compotée d oignons rouges, sauce secrète.', price: 5500, pop: false, pos: 3 },
  { cat: catMap['Desserts'], name: 'Moelleux cœur coulant chocolat', desc: 'Chocolat 70%, cœur fondant tiède, boule vanille de Madagascar.', price: 3000, pop: true, pos: 1 },
  { cat: catMap['Desserts'], name: 'Tiramisu traditionnel au café', desc: 'Biscuits imbibés espresso, mascarpone crémeux et cacao amer.', price: 2800, pop: false, pos: 2 },
  { cat: catMap['Boissons'], name: 'Jus de Bissap infusé à la menthe', desc: 'Fleurs d hibiscus bio, menthe fraîche et touche légère de vanille.', price: 1500, pop: true, pos: 1 },
  { cat: catMap['Boissons'], name: 'Cocktail de fruits frais pressés', desc: 'Orange, ananas, fruit de la passion et citron vert.', price: 2000, pop: false, pos: 2 },
];

for (const p of plats) {
  if (!p.cat) continue;
  const platRes = await client.query(
    'INSERT INTO plats (restaurant_id, category_id, name, description, price, is_available, is_popular, position) VALUES ($1, $2, $3, $4, $5, true, $6, $7) RETURNING id',
    [restId, p.cat, p.name, p.desc, p.price, p.pop, p.pos]
  );
  await client.query(
    'INSERT INTO stock (restaurant_id, plat_id, quantity, minimum_quantity) VALUES ($1, $2, 45, 10)',
    [restId, platRes.rows[0].id]
  );
}

await client.query(
  'INSERT INTO promotions (restaurant_id, name, code, type, value, start_date, end_date, is_active) VALUES ($1, $2, $3, $4, $5, now() - interval \'1 day\', now() + interval \'60 days\', true)',
  [restId, 'Offre Découverte', 'BIENVENUE10', 'percent', 10]
);

console.log('Dishes and stock seeded!');
await client.end();
