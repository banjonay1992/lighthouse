// A small D1Database stand-in backed by Node's built-in SQLite, so the real
// migrations and the real Store SQL run in tests without Cloudflare tooling.

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Value = SQLInputValue;

function normalise(values: unknown[]): Value[] {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    return v as Value;
  });
}

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    private readonly params: Value[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(this.db, this.sql, normalise(values));
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: { changes: number } }> {
    return this.allSync<T>();
  }

  allSync<T>(): { results: T[]; success: true; meta: { changes: number } } {
    const stmt = this.db.prepare(this.sql);
    if (/^\s*(select|with)\b/i.test(this.sql) || /\breturning\b/i.test(this.sql)) {
      const rows = stmt.all(...this.params) as T[];
      return { results: rows.map((r) => ({ ...(r as object) }) as T), success: true, meta: { changes: 0 } };
    }
    const res = stmt.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(res.changes) } };
  }

  async first<T>(column?: string): Promise<T | null> {
    const { results } = this.allSync<Record<string, unknown>>();
    const row = results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    return this.allSync();
  }

  async raw<T>(): Promise<T[]> {
    const { results } = this.allSync<Record<string, unknown>>();
    return results.map((r) => Object.values(r)) as T[];
  }
}

export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = join(import.meta.dirname, "..", "..", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  const api = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => s.allSync());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return api as unknown as D1Database;
}
