import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DB_FILE, MIGRATIONS, openStore, pickBackup, restoreBackup, SCHEMA_VERSION, SchemaTooNewError } from "./store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const backups = (): string[] => (existsSync(join(dir, "backup")) ? readdirSync(join(dir, "backup")).sort() : []);

test("a new store is at schema 1 in WAL mode and writes no backup", () => {
  expect(SCHEMA_VERSION).toBe(1);
  const s = openStore(dir);
  expect(s.schemaVersion()).toBe(1);
  expect((s.db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
  s.close();
  openStore(dir).close();
  expect(backups()).toEqual([]);
});

test("a database from a newer schema is refused with both versions in the message", () => {
  const s = openStore(dir);
  s.db.run("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
  s.close();
  expect(() => openStore(dir)).toThrow(SchemaTooNewError);
  expect(() => openStore(dir)).toThrow(/schema 2.*knows schema 1/);
});

test("a backup is written only on the start that migrates, named by the old schema", () => {
  openStore(dir).close();
  const v2 = [...MIGRATIONS, (db: Database) => db.run("CREATE TABLE extra (x INTEGER)")];
  const s = openStore(dir, { migrations: v2 });
  expect(s.schemaVersion()).toBe(2);
  s.close();
  expect(backups()).toHaveLength(1);
  expect(backups()[0]).toMatch(/^schema-1-\d+\.sqlite$/);
  openStore(dir, { migrations: v2 }).close();
  expect(backups()).toHaveLength(1);
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
  expect(pickBackup(dir, 1)).toBe(newest);
  expect(pickBackup(dir, 2)).toBeNull();
});
