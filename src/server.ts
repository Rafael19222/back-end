import { config } from './config';
import { systemClock } from './domain/clock';
import { BookingService } from './domain/service';
import { createApp } from './http/app';
import { createPool, PgQueries, PgUnitOfWork } from './infra/pg';
import { ValkeyCache } from './infra/valkey';

const pool = createPool(config.databaseUrl);
const service = new BookingService(new PgUnitOfWork(pool), new PgQueries(pool), new ValkeyCache(config.valkeyUrl), systemClock);

createApp(service).listen(config.port, () => console.log(`Studio Riff API on :${config.port}`));
