import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { databaseSchemaVersion, DB_FILE, MIGRATIONS, openStore, pickBackup, restoreBackup, SCHEMA_VERSION, SchemaTooNewError } from "./store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
// Only finished backups count; SQLite may keep a -journal file beside one while VACUUM INTO writes it.
const backups = (): string[] => (existsSync(join(dir, "backup")) ? readdirSync(join(dir, "backup")).filter((n) => n.endsWith(".sqlite")).sort() : []);

test("the migration list still has 2 entries, so this release runs no migration", () => {
  expect(MIGRATIONS).toHaveLength(2);
});

test("a new store is at schema 2 in WAL mode and writes no backup", () => {
  expect(SCHEMA_VERSION).toBe(2);
  const s = openStore(dir);
  expect(s.schemaVersion()).toBe(2);
  expect((s.db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
  s.close();
  openStore(dir).close();
  expect(backups()).toEqual([]);
});

test("a database from a newer schema is refused with both versions in the message", () => {
  const s = openStore(dir);
  s.db.run(`UPDATE meta SET value = '${String(SCHEMA_VERSION + 1)}' WHERE key = 'schema_version'`);
  s.close();
  expect(() => openStore(dir)).toThrow(SchemaTooNewError);
  expect(() => openStore(dir)).toThrow(new RegExp(`schema ${String(SCHEMA_VERSION + 1)}.*knows schema ${String(SCHEMA_VERSION)}`));
});

test("a backup is written only on the start that migrates, named by the old schema", () => {
  openStore(dir).close();
  const next = [...MIGRATIONS, (db: Database) => db.run("CREATE TABLE extra (x INTEGER)")];
  const s = openStore(dir, { migrations: next });
  expect(s.schemaVersion()).toBe(SCHEMA_VERSION + 1);
  s.close();
  expect(backups()).toHaveLength(1);
  expect(backups()[0]).toMatch(new RegExp(`^schema-${String(SCHEMA_VERSION)}-\\d+\\.sqlite$`));
  openStore(dir, { migrations: next }).close();
  expect(backups()).toHaveLength(1);
});

test("schema 2 adds shared_style (null) and queued_at (created_at) to existing rows after a schema-1 backup (AC-28)", () => {
  const v1 = openStore(dir, { migrations: MIGRATIONS.slice(0, 1) });
  v1.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES ('b1', 'prompt', '{}', 'h', 1)");
  v1.db.run(`INSERT INTO jobs (id, batch_id, position, kind, prompt, engine, faces, tex, style, seed, state, created_at)
    VALUES ('j1', 'b1', 0, 'prompt', 'a crate', 'trellis', 10000, 2048, 1, 7, 'done', 1234)`);
  v1.close();
  const s = openStore(dir);
  expect(s.schemaVersion()).toBe(2);
  expect(s.db.query("SELECT shared_style, queued_at FROM jobs WHERE id = 'j1'").get()).toEqual({ shared_style: null, queued_at: 1234 });
  s.close();
  expect(backups()[0]).toMatch(/^schema-1-\d+\.sqlite$/);
});

test("restore-backup brings back rows that were only in the WAL", () => {
  const s = openStore(dir);
  s.db.run("PRAGMA wal_autocheckpoint = 0");
  s.db.run("INSERT INTO batches (id, kind, presets, hash, created_at) VALUES ('b1', 'prompt', '{}', 'h', 1)");
  const backup = s.backupNow();
  s.close();
  const copy = mkdtempSync(join(tmpdir(), "restore-"));
  try {
    copyFileSync(backup, join(copy, "b.sqlite"));
    restoreBackup(copy, join(copy, "b.sqlite"));
    expect(existsSync(join(copy, `${DB_FILE}-wal`))).toBe(false);
    const db = new Database(join(copy, DB_FILE), { readonly: true });
    expect(db.query("SELECT id FROM batches").all()).toEqual([{ id: "b1" }]);
    db.close();
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("pickBackup chooses the newest backup of the requested schema", async () => {
  const s = openStore(dir);
  s.backupNow();
  await Bun.sleep(5);
  const newest = s.backupNow();
  s.close();
  expect(pickBackup(dir, SCHEMA_VERSION)).toBe(newest);
  expect(pickBackup(dir, SCHEMA_VERSION + 1)).toBeNull();
});

test("database-schema-version reads a cleanly closed WAL database read-only and leaves its rows alone (AC-15)", () => {
  const s = openStore(dir);
  s.db.run("INSERT INTO meta (key, value) VALUES ('probe', 'kept')");
  s.close();
  // A clean close checkpoints and removes -wal and -shm, the case a stopped app leaves behind.
  expect(existsSync(join(dir, `${DB_FILE}-wal`))).toBe(false);
  expect(databaseSchemaVersion(dir)).toBe(SCHEMA_VERSION);
  const check = new Database(join(dir, DB_FILE));
  expect(check.query("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
  expect(check.query("SELECT value FROM meta WHERE key = 'probe'").get()).toEqual({ value: "kept" });
  check.close();
});

test("database-schema-version reads a database the running app holds open, and reports none without a file", () => {
  const s = openStore(dir);
  s.db.run("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
  expect(databaseSchemaVersion(dir)).toBe(2);
  s.close();
  rmSync(join(dir, DB_FILE));
  expect(databaseSchemaVersion(dir)).toBe("none");
  expect(existsSync(join(dir, DB_FILE))).toBe(false);
});
