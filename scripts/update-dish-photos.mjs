import pg from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/DATABASE_URL=(.*)/);
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: { rejectUnauthorized: false }
});

await client.connect();

const dishImages = [
  {
    keyword: 'betterave',
    url: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'poireau',
    url: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'poulet',
    url: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'poisson',
    url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'burger',
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'chocolat',
    url: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'tiramisu',
    url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'bissap',
    url: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=800&q=80'
  },
  {
    keyword: 'cocktail',
    url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=800&q=80'
  }
];

const plats = await client.query('SELECT id, name FROM plats');
for (const p of plats.rows) {
  const matchImg = dishImages.find(img => p.name.toLowerCase().includes(img.keyword));
  if (matchImg) {
    await client.query('UPDATE plats SET image_url = $1 WHERE id = $2', [matchImg.url, p.id]);
    console.log(`Updated photo for: ${p.name}`);
  }
}

console.log('Dish photos updated!');
await client.end();
