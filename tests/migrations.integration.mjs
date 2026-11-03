import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
const base = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1','localhost'].includes(base.hostname)) throw new Error('Migration tests require a local development database');
const sql1 = await readFile(new URL('../prisma/migrations/20261101210000_initial/migration.sql', import.meta.url),'utf8');
const sql2 = await readFile(new URL('../prisma/migrations/20261101214000_workflow_input_modes/migration.sql', import.meta.url),'utf8');
for (const scenario of ['empty','legacy-initial','legacy-current','incompatible','changed-checksum']) {
  test(scenario, async () => {
    const name='agentra_migration_test_'+randomBytes(8).toString('hex');
    const admin=new pg.Client({connectionString:base.toString()});await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    const url=new URL(base);url.pathname='/'+name;
    const client=new pg.Client({connectionString:url.toString()});await client.connect();
    const run=()=>spawnSync(process.execPath,['scripts/migrate.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,DATABASE_URL:url.toString()},encoding:'utf8'});
    try {
      if(scenario.startsWith('legacy')) {
        await client.query(sql1);if(scenario==='legacy-current')await client.query(sql2);
        await client.query(`INSERT INTO "User" (id,address) VALUES ('preserve-me','0xexisting')`);
      }
      if(scenario==='incompatible')await client.query(`CREATE TABLE "User" (id text PRIMARY KEY); INSERT INTO "User" VALUES ('preserve-me')`);
      const result=run();
      if(scenario==='incompatible') {
        assert.notEqual(result.status,0);assert.match(result.stderr,/do not match/);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM "_agentra_migrations"')).rows[0].n,0);
      } else {
        assert.equal(result.status,0,result.stderr);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM "_agentra_migrations"')).rows[0].n,2);
        assert.equal(run().status,0,'Repeat migration must succeed');
      }
      if(scenario.startsWith('legacy')||scenario==='incompatible') assert.equal((await client.query(`SELECT id FROM "User" WHERE id='preserve-me'`)).rows[0].id,'preserve-me');
      assert.equal((await client.query(`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname LIKE 'agentra_baseline_%'`)).rows[0].n,0);
      if(scenario==='changed-checksum') {
        await client.query(`UPDATE "_agentra_migrations" SET checksum='tampered'`);
        const changed=run();assert.notEqual(changed.status,0);assert.match(changed.stderr,/Applied migration changed/);
      }
    } finally {
      await client.end();await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();
    }
  });
}
