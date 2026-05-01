import type { DBSchema } from "./types";

interface DBLike {
  exec(sql: string): Array<{ columns: string[]; values: Array<Array<unknown>> }>;
}

export class SchemaInspector {
  inspect(db: DBLike): DBSchema {
    const tables = new Map<string, string[]>();

    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Z%'"
    );
    if (result.length > 0) {
      for (const row of result[0].values) {
        const tableName = row[0] as string;
        const cols = db.exec(`PRAGMA table_info("${tableName}")`);
        if (cols.length > 0) {
          tables.set(tableName, cols[0].values.map((r) => r[1] as string));
        }
      }
    }

    const tableNames = Array.from(tables.keys()).map((n) => n.toLowerCase());
    const find = (patterns: string[]): string => {
      for (const p of patterns) {
        const idx = tableNames.findIndex((n) => n.includes(p));
        if (idx !== -1) return Array.from(tables.keys())[idx];
      }
      return "";
    };

    return {
      tables,
      bookTable: find(["zbook", "zdocument"]) || "ZBOOK",
      noteTable: find(["zbooknote", "znote", "zannotation"]) || "ZBOOKNOTE",
      topicTable: find(["ztopic", "zchapter"]) || "ZTOPIC",
    };
  }
}
