import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
export type Row = Record<string, any>;
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function openDatabase(
  path = process.env.DATABASE_PATH || "./data/hrm.sqlite",
) {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  if (
    !db
      .query("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
      .get()
  ) {
    // V3's user_id UNIQUE conflicts with dual employment; the same user may have records in multiple companies.
    db.exec(
      readFileSync(
        new URL("../migrations/003_multi_company_schema.sql", import.meta.url),
        "utf8",
      ),
    );
  }
  if (
    !db
      .query(
        "SELECT version FROM schema_migrations WHERE version='004_runtime' ",
      )
      .get()
  )
    db.exec(
      readFileSync(
        new URL("../migrations/004_runtime.sql", import.meta.url),
        "utf8",
      ),
    );
  return db;
}
export function repository(db: Database) {
  const one = (sql: string, ...params: any[]): Row | null =>
    db.query(sql).get(...params) as Row | null;
  const all = (sql: string, ...params: any[]): Row[] =>
    db.query(sql).all(...params) as Row[];
  const run = (sql: string, ...params: any[]) => db.query(sql).run(...params);
  const insert = (table: string, values: Row) => {
    const keys = Object.keys(values);
    run(
      `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ...Object.values(values),
    );
    return values;
  };
  const update = (table: string, values: Row, key: string, value: any) => {
    const keys = Object.keys(values);
    run(
      `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(",")} WHERE ${key}=?`,
      ...Object.values(values),
      value,
    );
  };
  return {
    one,
    all,
    run,
    insert,
    update,
    tx: <T>(fn: () => T): T => db.transaction(fn).immediate(),
  };
}
export type Repo = ReturnType<typeof repository>;
