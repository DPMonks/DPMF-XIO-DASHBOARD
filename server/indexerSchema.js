// This dashboard is SELECT-only. The indexer owns CREATE/ALTER. Probe the live
// public schema so we do not keep asking Postgres for tables or columns it
// never created (trades, order_book_history, reserve_quote, lp_supply, …).

const SCHEMA_TTL_MS = 10 * 60_000;

let cache = { at: 0, tables: null, ok: false };

export function resetIndexerSchemaCache() {
  cache = { at: 0, tables: null, ok: false };
}

export function peekIndexerSchema() {
  return cache.ok ? cache.tables : null;
}

export function schemaFromRows(rows = []) {
  const tables = new Map();
  for (const row of rows) {
    const table = String(row.table_name || row.table || "").toLowerCase();
    const column = String(row.column_name || row.column || "").toLowerCase();
    if (!table || !column) continue;
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(column);
  }
  return tables;
}

export function hasTable(schema, table) {
  if (!schema) return true;
  return schema.has(String(table || "").toLowerCase());
}

export function hasColumn(schema, table, column) {
  if (!schema) return true;
  return Boolean(schema.get(String(table || "").toLowerCase())?.has(String(column || "").toLowerCase()));
}

export function pickColumns(schema, table, wanted = []) {
  return (wanted || []).filter((column) => hasColumn(schema, table, column));
}

export function canSelect(schema, table, columns = []) {
  if (!hasTable(schema, table)) return false;
  return columns.every((column) => hasColumn(schema, table, column));
}

export async function loadIndexerSchema(db) {
  if (cache.ok && Date.now() - cache.at < SCHEMA_TTL_MS) return cache.tables;
  if (!db?.query) return cache.tables;
  try {
    const result = await db.query(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'`
    );
    const tables = schemaFromRows(result.rows);
    cache = { at: Date.now(), tables, ok: true };
    return tables;
  } catch {
    return cache.tables;
  }
}
