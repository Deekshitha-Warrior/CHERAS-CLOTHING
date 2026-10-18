import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { neon } from '@neondatabase/serverless';
import '../lib/neonConfig.mjs';
process.loadEnvFile('.env');
const source = ts.transpileModule(readFileSync('lib/neonQuery.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { NeonQuery } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const sql = neon(process.env.DATABASE_URL);
const from = table => new NeonQuery(table, (text, values) => sql.query(text, values));
const id = `neon-test-${crypto.randomUUID()}`;
async function run(query) { const result = await query; assert.equal(result.error, null, result.error?.message); return result.data; }
try {
  const category = await run(from('categories').insert({ id, name: id }).select('*').single());
  assert.equal(category.id, id);
  const upserted = await run(from('categories').upsert({ id: `${id}-other`, name: id }, { onConflict: 'name' }).select('*').single());
  assert.equal(upserted.id, id, 'Natural-key upsert preserves referenced primary key');
  const updated = await run(from('categories').update({ name: `${id}-changed` }).eq('id', id).select('*').single());
  assert.equal(updated.name, `${id}-changed`);
  assert.equal((await run(from('categories').select('id').in('id', [id]).order('name', { ascending: true }).range(0, 0))).length, 1);
  assert.deepEqual(await run(from('categories').select('*').in('id', [])), []);
  assert.equal(await run(from('categories').select('*').eq('id', `${id}-missing`).maybeSingle()), null);
  await run(from('customers').insert({ id, name: `Test ' " , ${id}`, phone: id }));
  assert.equal((await run(from('customers').select('*').searchCustomers(id))).length, 1);
  assert.deepEqual(await run(from('customers').select('*').searchCustomers("' OR TRUE --")), []);
  await run(from('staff').insert({ id, name: id }));
  await run(from('staff_attendance').upsert({ id, staff_id: id, attendance_date: '2026-01-01', status: 'PRESENT' }, { onConflict: 'staff_id,attendance_date' }));
  await run(from('staff_attendance').upsert({ id: `${id}-other`, staff_id: id, attendance_date: '2026-01-01', status: 'LEAVE' }, { onConflict: 'staff_id,attendance_date' }));
  const attendance = await run(from('staff_attendance').select('*').eq('staff_id', id).gte('attendance_date', '2026-01-01').lte('attendance_date', '2026-01-01').single());
  assert.equal(attendance.id, id);
  assert.equal(attendance.status, 'LEAVE');
  assert.equal(attendance.attendance_date, '2026-01-01');
  assert.equal(typeof attendance.updated_at, 'string');
  await run(from('products').insert([{ id, name: id, selling_price: 12.5 }, { id: `${id}-other`, name: id }]));
  const product = await run(from('products').select('*').eq('id', id).single());
  assert.equal(typeof product.selling_price, 'number');
  assert.equal(product.selling_price, 12.5);
  console.log('Live Neon CRUD, batch insert, upsert, search, pagination, date filters and numeric decoding: PASS');
} finally {
  for (const table of ['staff_attendance', 'staff', 'products', 'customers', 'categories']) {
    await run(from(table).delete().in('id', [id, `${id}-other`]));
  }
  console.log('Temporary test records removed');
}
