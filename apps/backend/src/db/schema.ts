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
      debounce_ms      INTEGER,
      layout_json      TEXT,
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

    CREATE TABLE IF NOT EXISTS custom_presets (
      id          TEXT    PRIMARY KEY,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      debounce_ms INTEGER,
      layout_json TEXT,
      units_json  TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_custom_presets_created_at ON custom_presets (created_at);
  `)

  if (!hasColumn(db, 'device_registry', 'debounce_ms')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN debounce_ms INTEGER`)
  }
  if (!hasColumn(db, 'device_registry', 'layout_json')) {
    db.exec(`ALTER TABLE device_registry ADD COLUMN layout_json TEXT`)
  }

  if (hasColumn(db, 'device_registry', 'topic_patterns')) {
    db.exec(`
      CREATE TABLE device_registry_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT    NOT NULL,
        debounce_ms      INTEGER,
        layout_json      TEXT,
        active           INTEGER NOT NULL DEFAULT 1,
        created_at       INTEGER NOT NULL
      );
      INSERT INTO device_registry_new (id, name, debounce_ms, layout_json, active, created_at)
        SELECT id, name, debounce_ms, layout_json, active, created_at FROM device_registry;
      DROP TABLE device_registry;
      ALTER TABLE device_registry_new RENAME TO device_registry;
    `)
  }
}
