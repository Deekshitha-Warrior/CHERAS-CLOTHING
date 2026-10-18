import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
process.loadEnvFile('.env');
const sql = neon(process.env.DATABASE_URL);
try {
  const [connection] = await sql`SELECT current_database() AS database, 1 AS connected`;
  console.log('Neon connection:', connection.connected === 1 ? 'PASS' : 'FAIL');
  const schema = readFileSync('schema.sql', 'utf8');
  const definitions = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)];
  const tables = definitions.map(match => match[1]);
  const existing = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
  const missing = tables.filter(table => !existing.some(row => row.table_name === table));
  if (missing.length) {
    console.error('Missing tables:', [...new Set(missing)].join(', '));
    console.error('Run the complete schema.sql in the Neon SQL Editor.');
    process.exitCode = 1;
  } else {
    for (const table of new Set(tables)) {
      await sql.query(`SELECT * FROM public."${table}" LIMIT 1`);
    }
    const actual = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
    for (const [, table, body] of definitions) {
      const expected = [...body.matchAll(/^\s+(\w+)\s+(?:TEXT|NUMERIC|BOOLEAN|DATE|TIMESTAMPTZ)\b/gm)].map(match => match[1]);
      for (const column of expected) {
        if (!actual.some(row => row.table_name === table && row.column_name === column)) throw new Error(`Missing schema column: ${table}.${column}`);
      }
    }
    for (const [, table, column] of schema.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)) {
      if (!actual.some(row => row.table_name === table && row.column_name === column)) throw new Error(`Missing upgrade column: ${table}.${column}`);
    }
    console.log('All POS tables readable: PASS');
    console.log('All required schema columns: PASS');
  }
} catch (error) {
  console.error('Database check failed:', error.code || error.name);
  process.exitCode = 1;
}
