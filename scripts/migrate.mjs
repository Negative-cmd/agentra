import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { baselineExistingDatabase } from './migration-baseline.mjs';

// Apply the version-controlled PostgreSQL SQL atomically with immutable checksums
// and a shared lock. This path does not need a downloaded native migration engine.
const directory = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(76250402)');
  await client.query('SET search_path TO public');
  await client.query('CREATE TABLE IF NOT EXISTS "_agentra_migrations" (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  const migrations = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(`${directory}/${entry.name}/migration.sql`, 'utf8');
    if (!sql.trim()) throw new Error(`Empty migration: ${entry.name}`);
    migrations.push({ name: entry.name, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  const history = await client.query('SELECT count(*)::int AS count FROM "_agentra_migrations"');
  if (history.rows[0].count === 0 && migrations.length) await baselineExistingDatabase(client, migrations);
  for (const { name, sql, checksum } of migrations) {
    const entry = { name };
    const previous = await client.query('SELECT checksum FROM "_agentra_migrations" WHERE name = $1', [entry.name]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${entry.name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO "_agentra_migrations" (name, checksum) VALUES ($1,$2)', [entry.name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${entry.name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  console.log('Database migrations are current.');
} finally {
  await client.query('SELECT pg_advisory_unlock(76250402)').catch(() => {});
  client.release();
  await pool.end();
}
