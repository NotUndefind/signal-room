import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from './schema'
import {
  getAllDevices, getDeviceById, insertDeviceWithUnits,
  deleteDevice, replaceDeviceUnits, updateDeviceMeta,
} from './registry'
import type { UnitInput } from '../interpreters/types'

function freshDb(): Database.Database {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  return db
}

const sampleUnit: UnitInput = {
  position: 0,
  name: 'Power',
  topic_pattern: 'home/lamp/state',
  json_path: 'POWER',
  condition: null,
  transform: { type: 'enum_map', map: { ON: true, OFF: false } },
  output_field: 'power',
  output_type: 'boolean',
  display: { label: 'Allumé', icon: 'Plug' },
}

describe('insertDeviceWithUnits + getAllDevices', () => {
  let db: Database.Database
  beforeEach(() => { db = freshDb() })

  it('insère un device avec ses units', () => {
    const id = insertDeviceWithUnits(db, {
      name: 'Lampe',
      debounce_ms: null,
      layout: null,
      units: [sampleUnit],
    })
    const list = getAllDevices(db)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Lampe')
    expect(list[0].units).toHaveLength(1)
    expect(list[0].units[0].output_field).toBe('power')
    expect(list[0].units[0].transform).toEqual({ type: 'enum_map', map: { ON: true, OFF: false } })
  })

  it('persiste condition, display, layout sérialisés', () => {
    insertDeviceWithUnits(db, {
      name: 'D',
      debounce_ms: 300,
      layout: { groups: [{ title: 'Etat', fields: ['power'] }] },
      units: [{ ...sampleUnit, condition: { path: 'flag', op: 'eq', value: true } }],
    })
    const d = getAllDevices(db)[0]
    expect(d.debounce_ms).toBe(300)
    expect(d.layout).toEqual({ groups: [{ title: 'Etat', fields: ['power'] }] })
    expect(d.units[0].condition).toEqual({ path: 'flag', op: 'eq', value: true })
    expect(d.units[0].display).toEqual({ label: 'Allumé', icon: 'Plug' })
  })

  it('tri par position', () => {
    insertDeviceWithUnits(db, {
      name: 'D', debounce_ms: null, layout: null,
      units: [
        { ...sampleUnit, position: 2, output_field: 'a' },
        { ...sampleUnit, position: 0, output_field: 'b' },
        { ...sampleUnit, position: 1, output_field: 'c' },
      ],
    })
    const d = getAllDevices(db)[0]
    expect(d.units.map(u => u.output_field)).toEqual(['b', 'c', 'a'])
  })
})

describe('getDeviceById', () => {
  it('retourne null si inexistant', () => {
    const db = freshDb()
    expect(getDeviceById(db, 999)).toBeNull()
  })
})

describe('deleteDevice', () => {
  it('supprime device et units en cascade', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'D', debounce_ms: null, layout: null, units: [sampleUnit] })
    expect(deleteDevice(db, id)).toBe(true)
    expect(getAllDevices(db)).toHaveLength(0)
    const remainingUnits = db.prepare('SELECT COUNT(*) as n FROM device_units').get() as { n: number }
    expect(remainingUnits.n).toBe(0)
  })

  it('retourne false si inconnu', () => {
    const db = freshDb()
    expect(deleteDevice(db, 999)).toBe(false)
  })
})

describe('replaceDeviceUnits', () => {
  it('remplace tous les units', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'D', debounce_ms: null, layout: null, units: [sampleUnit] })
    replaceDeviceUnits(db, id, [
      { ...sampleUnit, output_field: 'replaced' },
    ])
    const d = getDeviceById(db, id)!
    expect(d.units).toHaveLength(1)
    expect(d.units[0].output_field).toBe('replaced')
  })
})

describe('updateDeviceMeta', () => {
  it('met à jour les champs présents seulement', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'A', debounce_ms: null, layout: null, units: [sampleUnit] })
    updateDeviceMeta(db, id, { name: 'B', debounce_ms: 500 })
    const d = getDeviceById(db, id)!
    expect(d.name).toBe('B')
    expect(d.debounce_ms).toBe(500)
  })

  it('peut désactiver un device', () => {
    const db = freshDb()
    const id = insertDeviceWithUnits(db, { name: 'A', debounce_ms: null, layout: null, units: [sampleUnit] })
    updateDeviceMeta(db, id, { active: false })
    expect(getDeviceById(db, id)!.active).toBe(false)
  })
})

