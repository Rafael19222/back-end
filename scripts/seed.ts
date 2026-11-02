import { config } from '../src/config';
import { createPool } from '../src/infra/pg';
import { seed } from '../src/infra/seed';

const pool = createPool(config.databaseUrl);
await seed(pool);
console.log('Seed data inserted');
await pool.end();
