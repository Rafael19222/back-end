try {
  process.loadEnvFile('.env');
} catch {
  /* pas de .env : on utilise l'environnement tel quel */
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? '',
  valkeyUrl: process.env.VALKEY_URL ?? 'redis://localhost:6379',
  port: Number(process.env.PORT ?? 3000),
};
