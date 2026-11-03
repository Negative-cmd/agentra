import { randomBytes } from 'node:crypto';
const quote = name => '"' + name.replaceAll('"', '""') + '"';

/** Compare real PostgreSQL catalogs, not merely table names. No application
 * rows or definitions are changed when recognizing an existing installation. */
async function describe(client, schema, tables) {
  const result = {};
  const normalize = value => value?.replaceAll(quote(schema) + '.', '').replaceAll(schema + '.', '');
  for (const table of tables) {
    const relation = await client.query('SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2 AND c.relkind=\'r\'', [schema, table]);
    if (!relation.rowCount) return null;
    const oid = relation.rows[0].oid;
    const columns = await client.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default_value,
      a.attidentity AS identity, a.attgenerated AS generated
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`, [oid]);
    const constraints = await client.query(`SELECT conname AS name, contype::text AS type,
      pg_get_constraintdef(oid,true) AS definition, convalidated AS validated
      FROM pg_constraint WHERE conrelid=$1 ORDER BY conname`, [oid]);
    const indexes = await client.query(`SELECT c.relname AS name, i.indisunique AS unique, i.indisvalid AS valid,
      pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=$1 ORDER BY c.relname`, [oid]);
    result[table] = {
      columns: columns.rows.map(r => ({...r,default_value:normalize(r.default_value)})),
      constraints: constraints.rows.map(r => ({...r,definition:normalize(r.definition)})),
      indexes: indexes.rows.map(r => ({...r,definition:normalize(r.definition)})),
    };
  }
  return result;
}

export async function baselineExistingDatabase(client, migrations) {
  // Only the two audited legacy schema versions may be reconstructed here.
  // Future migrations must not be executed speculatively during baselining.
  const audited = ['20261101210000_initial', '20261101214000_workflow_input_modes'];
  migrations = migrations.slice(0, audited.length);
  if (migrations.some((m, i) => m.name !== audited[i])) throw new Error('Unrecognized legacy migration sequence; manual review required.');
  const tables = [...migrations[0].sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(match => match[1]).sort();
  if (!tables.length) return;
  const existing = await client.query('SELECT tablename FROM pg_tables WHERE schemaname=\'public\' AND tablename=ANY($1::text[])', [tables]);
  if (!existing.rowCount) return;
  const shadow = 'agentra_baseline_' + randomBytes(10).toString('hex');
  await client.query('BEGIN');
  try {
    // Block concurrent schema changes to existing app tables during comparison.
    await client.query('LOCK TABLE ' + existing.rows.map(r => 'public.' + quote(r.tablename)).join(',') + ' IN ACCESS SHARE MODE');
    await client.query('CREATE SCHEMA ' + quote(shadow));
    const actual = await describe(client, 'public', tables);
    let match = 0;
    for (let index = 0; index < migrations.length; index++) {
      await client.query('SET LOCAL search_path TO ' + quote(shadow));
      await client.query(migrations[index].sql);
      const expected = await describe(client, shadow, tables);
      if (actual && JSON.stringify(actual) === JSON.stringify(expected)) match = index + 1;
    }
    if (!match) throw new Error('Existing database tables do not match a complete Agentra migration version. No application data was changed. Use a dedicated empty Neon database for this deployment, or have the existing schema reviewed before migrating.');
    await client.query('SET LOCAL search_path TO public');
    for (const migration of migrations.slice(0, match)) {
      await client.query('INSERT INTO public."_agentra_migrations" (name,checksum) VALUES ($1,$2)', [migration.name,migration.checksum]);
    }
    // Only the scratch schema created above is removed; app tables stay intact.
    await client.query('DROP SCHEMA ' + quote(shadow) + ' CASCADE');
    await client.query('COMMIT');
    console.log(`Recognized ${match} existing Agentra migrations after exact schema verification; application data preserved.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
