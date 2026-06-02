import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from './schema'
import {
  insertCustomPreset, listCustomPresets, getCustomPresetById,
  updateCustomPreset, deleteCustomPreset,
} from './custom-presets'
import type { UnitInput } from '../interpreters/types'

function freshDb(): Database.Database {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  return db
}

const sampleUnits: UnitInput[] = [
  {
    position: 0,
    name: 'Power',
    topic_pattern: 'wled/lamp/v',
    json_path: 'on',
    condition: null,
    transform: { type: 'passthrough' },
    output_field: 'power',
    output_type: 'boolean',
    display: { label: 'Allumé' },
  },
]

describe('insertCustomPreset + listCustomPresets', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('insère un preset et le récupère par listCustomPresets', () => {
    const id = insertCustomPreset(db, {
      name: 'WLED ajusté',
      description: 'WLED avec bri scalé',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    expect(id).toMatch(/^custom_/)
    const list = listCustomPresets(db)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('WLED ajusté')
    expect(list[0].description).toBe('WLED avec bri scalé')
    expect(list[0].units).toEqual(sampleUnits)
    expect(list[0].created_at).toBeGreaterThan(0)
    expect(list[0].updated_at).toBeGreaterThan(0)
  })

  it('liste vide quand aucun preset', () => {
    expect(listCustomPresets(db)).toEqual([])
  })

  it('description par défaut est une chaîne vide', () => {
    const id = insertCustomPreset(db, {
      name: 'Sans description',
      description: '',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    const p = getCustomPresetById(db, id)
    expect(p?.description).toBe('')
  })
})

describe('getCustomPresetById', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('retourne le preset existant', () => {
    const id = insertCustomPreset(db, {
      name: 'P',
      description: '',
      debounce_ms: 100,
      layout: { groups: [{ title: 'G', fields: ['power'] }] },
      units: sampleUnits,
    })
    const p = getCustomPresetById(db, id)
    expect(p?.id).toBe(id)
    expect(p?.debounce_ms).toBe(100)
    expect(p?.layout).toEqual({ groups: [{ title: 'G', fields: ['power'] }] })
  })

  it('retourne null si introuvable', () => {
    expect(getCustomPresetById(db, 'custom_inexistant')).toBeNull()
  })
})

describe('updateCustomPreset', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('met à jour nom, description et units', () => {
    const id = insertCustomPreset(db, {
      name: 'V1',
      description: 'old',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    const before = getCustomPresetById(db, id)!.updated_at
    const newUnits: UnitInput[] = [{
      ...sampleUnits[0],
      output_field: 'state',
      transform: { type: 'enum_map', map: { true: 'on' } },
    }]
    const ok = updateCustomPreset(db, id, {
      name: 'V2',
      description: 'new',
      units: newUnits,
    })
    expect(ok).toBe(true)
    const after = getCustomPresetById(db, id)!
    expect(after.name).toBe('V2')
    expect(after.description).toBe('new')
    expect(after.units[0].output_field).toBe('state')
    expect(after.updated_at).toBeGreaterThanOrEqual(before)
  })

  it('retourne false si id inconnu', () => {
    const ok = updateCustomPreset(db, 'custom_inconnu', {
      name: 'X',
      description: '',
      units: sampleUnits,
    })
    expect(ok).toBe(false)
  })
})

describe('deleteCustomPreset', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('supprime et retourne true', () => {
    const id = insertCustomPreset(db, {
      name: 'X',
      description: '',
      debounce_ms: null,
      layout: null,
      units: sampleUnits,
    })
    expect(deleteCustomPreset(db, id)).toBe(true)
    expect(getCustomPresetById(db, id)).toBeNull()
  })

  it('retourne false si introuvable', () => {
    expect(deleteCustomPreset(db, 'custom_nope')).toBe(false)
  })
})
