import type Database from 'better-sqlite3'
import type { DeviceEntry, Unit, UnitInput, LayoutDescriptor } from '../interpreters/types'
import { findPreset, applyPreset, extractVars } from '../interpreters/presets'

interface DeviceRow {
  id: number
  name: string
  debounce_ms: number | null
  layout_json: string | null
  active: number
  created_at: number
  topic_patterns?: string | null
  interpreter_type?: string | null
}

interface UnitRow {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition_json: string | null
  transform_json: string
  output_field: string
  output_type: string
  display_json: string | null
  created_at: number
}

function parseUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    device_id: row.device_id,
    position: row.position,
    name: row.name,
    topic_pattern: row.topic_pattern,
    json_path: row.json_path,
    condition: row.condition_json ? JSON.parse(row.condition_json) : null,
    transform: JSON.parse(row.transform_json),
    output_field: row.output_field,
    output_type: row.output_type as Unit['output_type'],
    display: row.display_json ? JSON.parse(row.display_json) : null,
  }
}

function parseDevice(row: DeviceRow, units: Unit[]): DeviceEntry {
  return {
    id: row.id,
    name: row.name,
    debounce_ms: row.debounce_ms,
    layout: row.layout_json ? JSON.parse(row.layout_json) : null,
    units,
    active: row.active === 1,
    created_at: row.created_at,
  }
}

export function getAllDevices(db: Database.Database): DeviceEntry[] {
  const devices = db.prepare('SELECT * FROM device_registry ORDER BY created_at ASC').all() as DeviceRow[]
  const units = db.prepare('SELECT * FROM device_units ORDER BY device_id, position ASC').all() as UnitRow[]
  const byDevice = new Map<number, Unit[]>()
  for (const u of units) {
    const arr = byDevice.get(u.device_id) ?? []
    arr.push(parseUnit(u))
    byDevice.set(u.device_id, arr)
  }
  return devices.map(d => parseDevice(d, byDevice.get(d.id) ?? []))
}

export function getDeviceById(db: Database.Database, id: number): DeviceEntry | null {
  const row = db.prepare('SELECT * FROM device_registry WHERE id = ?').get(id) as DeviceRow | undefined
  if (!row) return null
  const units = db.prepare('SELECT * FROM device_units WHERE device_id = ? ORDER BY position ASC').all(id) as UnitRow[]
  return parseDevice(row, units.map(parseUnit))
}

export function insertDeviceWithUnits(
  db: Database.Database,
  payload: { name: string; debounce_ms: number | null; layout: LayoutDescriptor | null; units: UnitInput[] },
): number {
  const now = Date.now()
  const tx = db.transaction(() => {
    const res = db.prepare(`
      INSERT INTO device_registry (name, topic_patterns, interpreter_type, debounce_ms, layout_json, active, created_at)
      VALUES (?, '[]', '', ?, ?, 1, ?)
    `).run(payload.name, payload.debounce_ms, payload.layout ? JSON.stringify(payload.layout) : null, now)
    const deviceId = res.lastInsertRowid as number
    insertUnits(db, deviceId, payload.units, now)
    return deviceId
  })
  return tx()
}

export function insertUnits(
  db: Database.Database,
  deviceId: number,
  units: UnitInput[],
  now: number,
): void {
  const stmt = db.prepare(`
    INSERT INTO device_units
      (device_id, position, name, topic_pattern, json_path, condition_json, transform_json, output_field, output_type, display_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const u of units) {
    stmt.run(
      deviceId,
      u.position,
      u.name,
      u.topic_pattern,
      u.json_path,
      u.condition ? JSON.stringify(u.condition) : null,
      JSON.stringify(u.transform),
      u.output_field,
      u.output_type,
      u.display ? JSON.stringify(u.display) : null,
      now,
    )
  }
}

export function deleteDevice(db: Database.Database, id: number): boolean {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_units WHERE device_id = ?').run(id)
    return db.prepare('DELETE FROM device_registry WHERE id = ?').run(id)
  })
  return tx().changes > 0
}

export function replaceDeviceUnits(
  db: Database.Database,
  deviceId: number,
  units: UnitInput[],
): void {
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM device_units WHERE device_id = ?').run(deviceId)
    insertUnits(db, deviceId, units, now)
  })
  tx()
}

export function updateDeviceMeta(
  db: Database.Database,
  id: number,
  patch: { name?: string; debounce_ms?: number | null; layout?: LayoutDescriptor | null; active?: boolean },
): void {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name) }
  if (patch.debounce_ms !== undefined) { sets.push('debounce_ms = ?'); values.push(patch.debounce_ms) }
  if (patch.layout !== undefined) { sets.push('layout_json = ?'); values.push(patch.layout ? JSON.stringify(patch.layout) : null) }
  if (patch.active !== undefined) { sets.push('active = ?'); values.push(patch.active ? 1 : 0) }
  if (sets.length === 0) return
  values.push(id)
  db.prepare(`UPDATE device_registry SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

export function legacyRegistryRows(db: Database.Database): DeviceRow[] {
  return db.prepare(`
    SELECT r.* FROM device_registry r
    LEFT JOIN device_units u ON u.device_id = r.id
    WHERE u.id IS NULL
  `).all() as DeviceRow[]
}

const INTERPRETER_TO_PRESET: Record<string, string> = {
  frigate: 'frigate-camera',
  wled: 'wled',
  tasmota: 'tasmota-power',
  raw: 'raw-passthrough',
}

function deriveVarsForMigration(
  presetKey: string,
  legacyPattern: string,
  tasmotaPrefix: string,
): Record<string, string> | null {
  const preset = findPreset(presetKey)
  if (!preset) return null
  if (presetKey === 'raw-passthrough') return { topic: legacyPattern }
  if (presetKey === 'tasmota-power') {
    const refPattern = preset.units[0].topic_pattern.replace('{prefix}', tasmotaPrefix)
    const vars = extractVars(refPattern, legacyPattern)
    if (!vars) return null
    return { prefix: tasmotaPrefix, device_id: vars.device_id ?? '+' }
  }
  return extractVars(preset.units[0].topic_pattern, legacyPattern)
}

export function migrateLegacyRegistry(db: Database.Database, tasmotaPrefix: string): void {
  const rows = legacyRegistryRows(db)
  for (const row of rows) {
    const interpreterType = row.interpreter_type ?? ''
    const presetKey = INTERPRETER_TO_PRESET[interpreterType]
    if (!presetKey) {
      console.warn(`[Migration] interpreter_type inconnu pour device ${row.id} (${row.name}): ${interpreterType}`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const preset = findPreset(presetKey)
    if (!preset) {
      console.warn(`[Migration] preset introuvable: ${presetKey}`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const patterns: string[] = row.topic_patterns ? JSON.parse(row.topic_patterns) : []
    const firstPattern = patterns[0]
    if (!firstPattern) {
      console.warn(`[Migration] device ${row.id} (${row.name}) sans topic_patterns, désactivé`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const vars = deriveVarsForMigration(presetKey, firstPattern, tasmotaPrefix)
    if (!vars) {
      console.warn(`[Migration] impossible d'extraire les placeholders pour ${row.name} (${firstPattern}), device désactivé`)
      updateDeviceMeta(db, row.id, { active: false })
      continue
    }
    const units = applyPreset(preset, vars)
    insertUnits(db, row.id, units, Date.now())
    updateDeviceMeta(db, row.id, { debounce_ms: preset.debounce_ms })
    console.log(`[Migration] device ${row.id} (${row.name}) migré vers preset ${presetKey}`)
  }
}
