import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { UnitInput, LayoutDescriptor } from '../interpreters/types'

export interface CustomPreset {
  id: string
  name: string
  description: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  units: UnitInput[]
  created_at: number
  updated_at: number
}

interface Row {
  id: string
  name: string
  description: string
  debounce_ms: number | null
  layout_json: string | null
  units_json: string
  created_at: number
  updated_at: number
}

function parse(row: Row): CustomPreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    debounce_ms: row.debounce_ms,
    layout: row.layout_json ? JSON.parse(row.layout_json) : null,
    units: JSON.parse(row.units_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function insertCustomPreset(
  db: Database.Database,
  payload: {
    name: string
    description: string
    debounce_ms: number | null
    layout: LayoutDescriptor | null
    units: UnitInput[]
  },
): string {
  const id = `custom_${randomUUID()}`
  const now = Date.now()
  db.prepare(`
    INSERT INTO custom_presets (id, name, description, debounce_ms, layout_json, units_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.name,
    payload.description,
    payload.debounce_ms,
    payload.layout ? JSON.stringify(payload.layout) : null,
    JSON.stringify(payload.units),
    now,
    now,
  )
  return id
}

export function listCustomPresets(db: Database.Database): CustomPreset[] {
  const rows = db.prepare('SELECT * FROM custom_presets ORDER BY created_at ASC').all() as Row[]
  return rows.map(parse)
}

export function getCustomPresetById(db: Database.Database, id: string): CustomPreset | null {
  const row = db.prepare('SELECT * FROM custom_presets WHERE id = ?').get(id) as Row | undefined
  return row ? parse(row) : null
}

export function updateCustomPreset(
  db: Database.Database,
  id: string,
  patch: { name: string; description: string; units: UnitInput[] },
): boolean {
  const now = Date.now()
  const res = db.prepare(`
    UPDATE custom_presets
       SET name = ?, description = ?, units_json = ?, updated_at = ?
     WHERE id = ?
  `).run(patch.name, patch.description, JSON.stringify(patch.units), now, id)
  return res.changes > 0
}

export function deleteCustomPreset(db: Database.Database, id: string): boolean {
  const res = db.prepare('DELETE FROM custom_presets WHERE id = ?').run(id)
  return res.changes > 0
}
