import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

/** Same key for every replica, so only one applies migrations at a time. */
const LOCK_KEY = 728_401_553;

/** dist/database -> project root, where the Dockerfile copies migrations/. */
export const DEFAULT_MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * Applies pending `migrations/*.sql` files in name order and records each one
 * in `schema_migrations`. Each file manages its own transaction. Files must stay
 * idempotent: a database created before this runner existed has the tables but
 * no records, so every file runs once more on its first startup.
 */
export async function runMigrations(connectionString: string, dir = DEFAULT_MIGRATIONS_DIR, log: (message: string) => void = console.log): Promise<string[]> {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
    const applied: string[] = [];
    for (const name of files) {
      if (done.has(name)) continue;
      log(`Aplicando migration ${name}`);
      try {
        await client.query(await readFile(join(dir, name), 'utf8'));
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${name} falhou`, { cause: error });
      }
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      applied.push(name);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
