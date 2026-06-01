import type Database from 'better-sqlite3'

interface ColumnInfo { name: string }

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
  return rows.some(r => r.name === column)
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      topic      TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload    TEXT NOT NULL,
      raw        TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_source ON events (source);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);

    CREATE TABLE IF NOT EXISTS device_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      source     TEXT NOT NULL,
      state      TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_source ON device_snapshots (source);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON device_snapshots (created_at);

    CREATE TABLE IF NOT EXISTS topics_seen (
      topic         TEXT    PRIMARY KEY,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 1,
      detected_type TEXT
    );

    CREATE TABLE IF NOT EXISTS device_registry (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      topic_patterns   TEXT    NOT NULL,
      interpreter_type TEXT    NOT NULL,
      active           INTEGER NOT NULL DEFAULT 1,
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_units (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id      INTEGER NOT NULL REFERENCES device_registry(id) ON DELETE CASCADE,
      position       INTEGER NOT NULL,
      name           TEXT    NOT NULL,
      topic_pattern  TEXT    NOT NULL,
      json_path      TEXT,
      condition_json TEXT,
      transform_json TEXT    NOT NULL,
      output_field   TEXT    NOT NULL,
      output_type    TEXT    NOT NULL,
      display_json   TEXT,
      created_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_units_device ON device_units (device_id);
  `)

  if (!hasColumn(db, 'device_registry', 'debounce_ms')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN debounce_ms INTEGER`)
  }
  if (!hasColumn(db, 'device_registry', 'layout_json')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN layout_json TEXT`)
  }
}
