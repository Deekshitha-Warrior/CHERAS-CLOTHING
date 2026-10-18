import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const port = 3127;
const base = `http://localhost:${port}`;
const actions = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')).node;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
async function action(name, args = []) {
  const id = Object.keys(actions).find(id => actions[id].exportedName === name);
  assert.ok(id, `Missing action ${name}`);
  const response = await fetch(`${base}/pos`, {
    method: 'POST', headers: { 'Next-Action': id, 'Content-Type': 'text/plain;charset=UTF-8', Origin: base, Accept: 'text/x-component' }, body: JSON.stringify(args),
  });
  assert.equal(response.status, 200, `${name} HTTP status`);
  const body = await response.text();
  assert.ok(!/^\w+:E\{/m.test(body), `${name} returned an action error`);
  const line = body.split('\n').find(line => line.startsWith('1:'));
  assert.ok(line, `${name} has no result`);
  const result = JSON.parse(line.slice(2));
  assert.ok(!result?.error, `${name} returned an error`);
  console.log(`${name}: PASS`);
  return result;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Production server did not start');
  for (const route of ['/', '/pos', '/store']) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Cheras/i);
    console.log(`${route}: HTTP 200`);
  }
  const connection = await action('checkDatabaseConfigured');
  assert.equal(connection.configured, true);
  for (const name of ['fetchProducts', 'fetchCategories', 'fetchCustomers', 'fetchOrders', 'fetchAdvanceOrders', 'fetchExpenses', 'fetchStaff', 'fetchOffers', 'fetchBirthdayLogs', 'fetchShopSettings']) await action(name);
  const category = await action('createCategory', [`smoke-${crypto.randomUUID()}`]);
  assert.ok(category.id);
  try { assert.ok(await action('renameCategory', [category.id, `${category.name}-updated`])); }
  finally { await action('removeCategory', [category.id]); }
  assert.ok(!/Failed to load shop settings|Neon request failed/i.test(logs), 'Database error in server logs');
  console.log('Production routes and Server Actions through Neon: PASS');
} finally { server.kill(); }
