// SQLite store: schema, migrations, backups and restore. One database file per data directory.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export const DB_FILE = "asset-studio.sqlite";
export type Migration = (db: Database) => void;

/** Migration i brings the schema from version i to i + 1. */
export const MIGRATIONS: Migration[] = [
  (db) => {
    db.run(`CREATE TABLE batches (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('prompt', 'image')),
      presets TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      position INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('prompt', 'image')),
      prompt TEXT,
      upload_name TEXT,
      upload_ext TEXT,
      engine TEXT NOT NULL,
      faces INTEGER NOT NULL,
      tex INTEGER,
      style INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending', 'submitted', 'done', 'failed', 'cancelled')),
      prompt_id TEXT,
      posted_at INTEGER,
      attempts INTEGER NOT NULL DEFAULT 1,
      losses INTEGER NOT NULL DEFAULT 0,
      server_errors INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      fixture INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    )`);
    db.run("CREATE INDEX jobs_state ON jobs (state, created_at, position)");
    db.run("CREATE INDEX jobs_batch ON jobs (batch_id, position)");
  },
];
export const SCHEMA_VERSION = MIGRATIONS.length;

export class SchemaTooNewError extends Error {}

export interface Store {
  db: Database;
  dataDir: string;
  schemaVersion(): number;
  /** Writes a consistent copy of the database to backup/schema-<version>-<ms>.sqlite and returns its path. */
  backupNow(): string;
  close(): void;
}

function readVersion(db: Database): number {
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | null;
  return row ? Number(row.value) : 0;
}

export function openStore(dataDir: string, opts: { migrations?: Migration[] } = {}): Store {
  const migrations = opts.migrations ?? MIGRATIONS;
  const target = migrations.length;
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, DB_FILE), { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  const store: Store = {
    db,
    dataDir,
    schemaVersion: () => readVersion(db),
    backupNow: () => {
      const dir = join(dataDir, "backup");
      mkdirSync(dir, { recursive: true });
      let path = join(dir, `schema-${readVersion(db)}-${Date.now()}.sqlite`);
      for (let n = 1; existsSync(path); n++) path = join(dir, `schema-${readVersion(db)}-${Date.now() + n}.sqlite`);
      db.run(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
      return path;
    },
    close: () => {
      db.close();
    },
  };
  const current = readVersion(db);
  if (current > target) {
    db.close();
    throw new SchemaTooNewError(`database is at schema ${current}, but this executable only knows schema ${target}`);
  }
  if (current < target) {
    if (current > 0) store.backupNow();
    for (let v = current; v < target; v++) {
      const migrate = migrations[v];
      if (!migrate) throw new Error(`missing migration ${v}`);
      db.transaction(() => {
        migrate(db);
        db.run("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(v + 1)]);
      })();
    }
  }
  return store;
}

/** Replaces the database in dataDir with a backup copy, removing any WAL and shared-memory files. */
export function restoreBackup(dataDir: string, backupFile: string): void {
  const db = join(dataDir, DB_FILE);
  rmSync(`${db}-wal`, { force: true });
  rmSync(`${db}-shm`, { force: true });
  copyFileSync(backupFile, db);
}

/** Newest backup of the given schema version, or null. */
export function pickBackup(dataDir: string, schema: number): string | null {
  const dir = join(dataDir, "backup");
  if (!existsSync(dir)) return null;
  const re = new RegExp(`^schema-${schema}-(\\d+)\\.sqlite$`);
  const found = readdirSync(dir)
    .map((name) => ({ name, m: re.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  return found[0] ? join(dir, found[0].name) : null;
}
