import { execSync } from "child_process";
import * as fs from "fs";
import type { DBSchema } from "./types";
import { SchemaInspector } from "./SchemaInspector";

interface DBLike {
  exec(sql: string): Array<{ columns: string[]; values: Array<Array<unknown>> }>;
  close(): void;
}

class Sqlite3CLI implements DBLike {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  exec(sql: string): Array<{ columns: string[]; values: Array<Array<unknown>> }> {
    try {
      const output = execSync(
        `sqlite3 -json "${this.dbPath}" "${sql.replace(/"/g, '\\"')}"`,
        { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, timeout: 30000 }
      ).trim();

      if (!output) return [];

      const rows: Array<Record<string, unknown>> = JSON.parse(output);
      if (rows.length === 0) return [];

      const columns = Object.keys(rows[0]);
      const values = rows.map((row) => columns.map((col) => row[col] ?? null));

      return [{ columns, values }];
    } catch (e) {
      if (e instanceof SyntaxError) {
        // JSON parse failed — likely empty result from non-SELECT or no rows
        return [];
      }
      throw e;
    }
  }

  close() {}
}

export class MNBackupParser {
  private db: DBLike | null = null;
  private schema: DBSchema | null = null;
  private inspector: SchemaInspector;

  constructor() {
    this.inspector = new SchemaInspector();
  }

  loadDatabase(dbPath: string): { db: DBLike; schema: DBSchema } {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`MarginNote database not found: ${dbPath}`);
    }

    this.db = new Sqlite3CLI(dbPath);
    this.schema = this.inspector.inspect(this.db);
    return { db: this.db, schema: this.schema };
  }

  getSchema(): DBSchema | null {
    return this.schema;
  }

  close() {
    this.db = null;
  }
}
