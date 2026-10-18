/** Parameterized PostgreSQL query builder for the POS repositories. */
type Row = Record<string, unknown>;
type Result = { data: Row[] | Row | null; error: { message: string; code?: string } | null };
type Executor = (sql: string, values: unknown[]) => Promise<Row[]>;
const identifier = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Invalid SQL identifier');
  return `"${name}"`;
};
const columns = (names: string) => names === '*' ? '*' : names.split(',').map(identifier).join(', ');
export class NeonQuery implements PromiseLike<Result> {
  private operation = 'select';
  private projection = '*';
  private returning = false;
  private records: Row[] = [];
  private filters: string[] = [];
  private values: unknown[] = [];
  private sorting: string[] = [];
  private count?: number;
  private offset = 0;
  private cardinality?: 'one' | 'optional';
  private conflict?: { onConflict: string; ignoreDuplicates?: boolean };
  constructor(private table: string, private execute: Executor) { identifier(table); }
  private bind(value: unknown) { this.values.push(value); return `$${this.values.length}`; }
  select(names = '*') { this.projection = columns(names); this.returning = this.operation !== 'select'; return this; }
  insert(value: Row | Row[]) { this.operation = 'insert'; this.records = Array.isArray(value) ? value : [value]; return this; }
  upsert(value: Row | Row[], options: { onConflict: string; ignoreDuplicates?: boolean }) { this.insert(value); this.conflict = options; return this; }
  update(value: Row) { this.operation = 'update'; this.records = [value]; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column: string, value: unknown) { this.filters.push(value === null ? `${identifier(column)} IS NULL` : `${identifier(column)} = ${this.bind(value)}`); return this; }
  gte(column: string, value: unknown) { this.filters.push(`${identifier(column)} >= ${this.bind(value)}`); return this; }
  lte(column: string, value: unknown) { this.filters.push(`${identifier(column)} <= ${this.bind(value)}`); return this; }
  in(column: string, values: unknown[]) { this.filters.push(values.length ? `${identifier(column)} IN (${values.map(v => this.bind(v)).join(', ')})` : 'FALSE'); return this; }
  searchCustomers(term: string) { const value = this.bind(`%${term}%`); this.filters.push(`("name" ILIKE ${value} OR "phone" ILIKE ${value})`); return this; }
  order(column: string, options: { ascending: boolean }) { this.sorting.push(`${identifier(column)} ${options.ascending ? 'ASC' : 'DESC'}`); return this; }
  limit(count: number) { this.count = count; return this; }
  range(from: number, to: number) { this.offset = from; this.count = to - from + 1; return this; }
  single() { this.cardinality = 'one'; return this; }
  maybeSingle() { this.cardinality = 'optional'; return this; }
  private async run(): Promise<Result> {
    try {
      const table = `public.${identifier(this.table)}`;
      let text: string;
      if (this.operation === 'select') text = `SELECT ${this.projection} FROM ${table}`;
      else if (this.operation === 'delete') text = `DELETE FROM ${table}`;
      else {
        const keys = [...new Set(this.records.flatMap(row => Object.keys(row).filter(key => row[key] !== undefined)))];
        if (!keys.length) throw new Error('Empty database write');
        if (this.operation === 'update') text = `UPDATE ${table} SET ${keys.map(key => `${identifier(key)} = ${this.bind(this.records[0][key])}`).join(', ')}`;
        else {
          text = `INSERT INTO ${table} (${keys.map(identifier).join(', ')}) VALUES ${this.records.map(row => `(${keys.map(key => row[key] === undefined ? 'DEFAULT' : this.bind(row[key])).join(', ')})`).join(', ')}`;
          if (this.conflict) {
            const targets = this.conflict.onConflict.split(',');
            const updates = keys.filter(key => key !== 'id');
            text += ` ON CONFLICT (${targets.map(identifier).join(', ')}) `;
            text += this.conflict.ignoreDuplicates || !updates.length ? 'DO NOTHING' : `DO UPDATE SET ${updates.map(key => `${identifier(key)} = EXCLUDED.${identifier(key)}`).join(', ')}`;
          }
        }
      }
      if (this.filters.length) text += ` WHERE ${this.filters.join(' AND ')}`;
      if (this.operation === 'select') {
        text += ` ORDER BY ${this.sorting.length ? this.sorting.join(', ') : '"id" ASC'}`;
        if (this.count !== undefined) text += ` LIMIT ${this.bind(this.count)}`;
        if (this.offset) text += ` OFFSET ${this.bind(this.offset)}`;
      } else if (this.returning) text += ` RETURNING ${this.projection}`;
      const data = await this.execute(text, this.values);
      if (this.cardinality) {
        if (data.length > 1 || (this.cardinality === 'one' && data.length !== 1)) throw new Error('Unexpected database row count');
        return { data: data[0] ?? null, error: null };
      }
      return { data: this.operation === 'select' || this.returning ? data : null, error: null };
    } catch (error) {
      const err = error as Error & { code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }
  then<T = Result, U = never>(fulfilled?: ((value: Result) => T | PromiseLike<T>) | null, rejected?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> { return this.run().then(fulfilled, rejected); }
}
