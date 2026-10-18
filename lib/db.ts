import 'server-only';
import './neonConfig.mjs';
import { neon } from '@neondatabase/serverless';
import { NeonQuery } from './neonQuery';
export class DatabaseUnavailableError extends Error {
  code = 'DATABASE_UNAVAILABLE';
  constructor(message = 'Neon is not configured. Set DATABASE_URL in .env.') { super(message); this.name = 'DatabaseUnavailableError'; }
}
export class DatabaseQueryError extends Error {
  constructor(message: string, public code?: string) { super(message); this.name = 'DatabaseQueryError'; }
}
export function isDatabaseConfigured(): boolean {
  try { const url = new URL(process.env.DATABASE_URL?.trim() || ''); return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname && url.password); } catch { return false; }
}
export function getSanitizedDatabaseUrl(): string {
  return isDatabaseConfigured() ? new URL(process.env.DATABASE_URL!).hostname : '[NOT CONFIGURED]';
}
let sql: ReturnType<typeof neon<false, false>> | undefined;
export function getSql() {
  if (!isDatabaseConfigured()) throw new DatabaseUnavailableError();
  return sql ??= neon<false, false>(process.env.DATABASE_URL!);
}
export function getDatabaseClient() {
  return { from: (table: string) => new NeonQuery(table, async (text, values) => getSql().query(text, values, { fetchOptions: { signal: AbortSignal.timeout(15000) } })) };
}
export async function checkDatabaseConnection(): Promise<void> {
  await getSql()`SELECT 1 AS connected`;
  await getSql()`SELECT id FROM categories LIMIT 1`;
}
