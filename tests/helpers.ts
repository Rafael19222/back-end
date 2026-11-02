import { config } from '../src/config';
import { fixedClock } from '../src/domain/clock';
import { noCache, type PlanningCache } from '../src/domain/ports';
import { BookingService } from '../src/domain/service';
import { createApp } from '../src/http/app';
import { migrate } from '../src/infra/migrate';
import { createPool, PgQueries, PgUnitOfWork } from '../src/infra/pg';
import { resetAndSeed } from '../src/infra/seed';

export const NOW = '2026-11-02T09:00:00Z'; // lundi 2 novembre 2026, 9 h
export const pool = createPool(config.testDatabaseUrl);

export async function prepareDb() {
  await migrate(pool);
}

/** Chaque test repart des données de départ. */
export const resetDb = () => resetAndSeed(pool);

export function makeApp(cache: PlanningCache = noCache) {
  const service = new BookingService(new PgUnitOfWork(pool), new PgQueries(pool), cache, fixedClock(NOW));
  return createApp(service);
}
