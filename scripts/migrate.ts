import { config } from '../src/config';
import { migrate } from '../src/infra/migrate';
import { createPool } from '../src/infra/pg';

const pool = createPool(config.databaseUrl);
const done = await migrate(pool);
console.log(done.length ? `Applied: ${done.join(', ')}` : 'Nothing to apply');
await pool.end();
