import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from './schema'
import { getAllDevices, insertDevice, deleteDevice, seedDeviceRegistry } from './registry'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

describe('insertDevice / getAllDevices', () => {
  it('insère et récupère un device avec topic_patterns parsé', () => {
    const db = makeDb()
    const id = insertDevice(db, {
      name: 'Mon capteur',
      topic_patterns: ['home/+/temp'],
      interpreter_type: 'raw',
    })
    const devices = getAllDevices(db)
    expect(devices).toHaveLength(1)
    expect(devices[0].id).toBe(id)
    expect(devices[0].name).toBe('Mon capteur')
    expect(devices[0].topic_patterns).toEqual(['home/+/temp'])
    expect(devices[0].interpreter_type).toBe('raw')
    expect(devices[0].active).toBe(1)
  })
})

describe('deleteDevice', () => {
  it('supprime un device existant et retourne true', () => {
    const db = makeDb()
    const id = insertDevice(db, { name: 'X', topic_patterns: ['a/b'], interpreter_type: 'raw' })
    expect(deleteDevice(db, id)).toBe(true)
    expect(getAllDevices(db)).toHaveLength(0)
  })

  it('retourne false pour un id inexistant', () => {
    const db = makeDb()
    expect(deleteDevice(db, 9999)).toBe(false)
  })
})

describe('seedDeviceRegistry', () => {
  it('insère Frigate, Tasmota, WLED si la table est vide', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const devices = getAllDevices(db)
    expect(devices).toHaveLength(3)
    const names = devices.map(d => d.name)
    expect(names).toContain('Frigate')
    expect(names).toContain('Tasmota')
    expect(names).toContain('WLED')
  })

  it("n'insère pas si la table contient déjà des entrées", () => {
    const db = makeDb()
    insertDevice(db, { name: 'Existing', topic_patterns: ['x'], interpreter_type: 'raw' })
    seedDeviceRegistry(db, '')
    expect(getAllDevices(db)).toHaveLength(1)
  })

  it('applique le préfixe Tasmota', () => {
    const db = makeDb()
    seedDeviceRegistry(db, 'home/')
    const tasmota = getAllDevices(db).find(d => d.name === 'Tasmota')!
    expect(tasmota.topic_patterns).toContain('home/tele/+/STATE')
  })
})
