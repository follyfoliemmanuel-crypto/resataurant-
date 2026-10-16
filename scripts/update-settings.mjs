import pg from 'pg';
import fs from 'node:fs';

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/DATABASE_URL=(.*)/);
const client = new pg.Client({
  connectionString: match[1].trim(),
  ssl: { rejectUnauthorized: false }
});

await client.connect();
await client.query(`
  UPDATE restaurant_settings SET 
    restaurant_name = $1,
    description = $2,
    address = $3,
    city = $4,
    email = $5,
    delivery_enabled = true,
    delivery_fee = 1000,
    opening_hours = $6
  WHERE restaurant_id = '11478407-f2d8-44b6-97a7-697152ba3245'
`, [
  'Savora Restaurant & Grill',
  'Une expérience culinaire d exception : viandes braisées, poissons nobles et saveurs gourmandes cuisinées à la perfection.',
  'Boulevard du 13 Janvier',
  'Lomé',
  'contact@savora.restaurant',
  JSON.stringify({
    monday: { open: "11:30", close: "23:00" },
    tuesday: { open: "11:30", close: "23:00" },
    wednesday: { open: "11:30", close: "23:00" },
    thursday: { open: "11:30", close: "23:00" },
    friday: { open: "11:30", close: "00:00" },
    saturday: { open: "11:30", close: "00:00" },
    sunday: { open: "12:00", close: "22:30" }
  })
]);

console.log('Settings successfully updated!');
await client.end();
