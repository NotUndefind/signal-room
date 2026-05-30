import type Database from 'better-sqlite3'

export interface DeviceEntry {
  id: number
  name: string
  topic_patterns: string[]
  interpreter_type: 'frigate' | 'tasmota' | 'wled' | 'raw'
  active: number
  created_at: number
}

interface DeviceRow {
  id: number
  name: string
  topic_patterns: string
  interpreter_type: string
  active: number
  created_at: number
}

function parseRow(row: DeviceRow): DeviceEntry {
  return {
    ...row,
    topic_patterns: JSON.parse(row.topic_patterns) as string[],
    interpreter_type: row.interpreter_type as DeviceEntry['interpreter_type'],
  }
}

export function getAllDevices(db: Database.Database): DeviceEntry[] {
  const rows = db.prepare(
    'SELECT * FROM device_registry ORDER BY created_at ASC'
  ).all() as DeviceRow[]
  return rows.map(parseRow)
}

export function insertDevice(
  db: Database.Database,
  device: { name: string; topic_patterns: string[]; interpreter_type: string }
): number {
  const result = db.prepare(`
    INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(device.name, JSON.stringify(device.topic_patterns), device.interpreter_type, Date.now())
  return result.lastInsertRowid as number
}

export function deleteDevice(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM device_registry WHERE id = ?').run(id)
  return result.changes > 0
}

export function seedDeviceRegistry(db: Database.Database, tasmotaPrefix = ''): void {
  const { count } = db.prepare(
    'SELECT COUNT(*) as count FROM device_registry'
  ).get() as { count: number }
  if (count > 0) return

  const p = tasmotaPrefix
  const now = Date.now()
  const insert = db.prepare(`
    INSERT INTO device_registry (name, topic_patterns, interpreter_type, active, created_at)
    VALUES (?, ?, ?, 1, ?)
  `)

  insert.run('Frigate', JSON.stringify(['frigate/+/events']), 'frigate', now)
  insert.run(
    'Tasmota',
    JSON.stringify([`${p}stat/+/RESULT`, `${p}tele/+/STATE`, `${p}tele/+/SENSOR`]),
    'tasmota',
    now + 1
  )
  insert.run('WLED', JSON.stringify(['wled/+/v']), 'wled', now + 2)
}
