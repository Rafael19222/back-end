import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

/** Applique les fichiers migrations/*.sql dans l'ordre, une seule fois chacun. */
export async function migrate(pool: pg.Pool, dir = path.resolve('migrations')): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      done.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return done;
}
