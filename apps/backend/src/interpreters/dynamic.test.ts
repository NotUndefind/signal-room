import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from '../db/schema'
import { seedDeviceRegistry, insertDevice } from '../db/registry'
import { createDynamicRegistry } from './dynamic'
import type { Config } from '../config'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

const config: Config = {
  mqtt: { host: 'localhost', port: 1883, username: 'test' },
  redis: { url: 'redis://localhost:6379' },
  db: { path: ':memory:' },
  retention: { days: 30 },
  frigate: { debounceMs: 300 },
  tasmota: { topicPrefix: '' },
  port: 3001,
}

describe('createDynamicRegistry', () => {
  it('route un message frigate vers le bon interpréteur', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const registry = createDynamicRegistry(db, config)
    const payload = Buffer.from(JSON.stringify({
      type: 'new',
      after: { id: 'x', label: 'person', camera: 'cam1', current_zones: [], score: 0.9 },
    }))
    const result = registry.route('frigate/cam1/events', payload)
    expect(result?.source).toBe('frigate')
  })

  it('retourne null pour un topic non configuré', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    const result = registry.route('unknown/topic', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('prend en compte un device ajouté dynamiquement', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    registry.addDevice({
      id: 1, name: 'Test', topic_patterns: ['home/+/temp'],
      interpreter_type: 'raw', active: 1, created_at: Date.now(),
    })
    const result = registry.route('home/sensor/temp', Buffer.from('{"v":22}'))
    expect(result?.source).toBe('raw')
  })

  it('ne route plus après removeDevice', () => {
    const db = makeDb()
    const registry = createDynamicRegistry(db, config)
    registry.addDevice({
      id: 99, name: 'Tmp', topic_patterns: ['tmp/topic'],
      interpreter_type: 'raw', active: 1, created_at: Date.now(),
    })
    registry.removeDevice(99)
    const result = registry.route('tmp/topic', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('retourne le debounceMs de l\'interpréteur correspondant', () => {
    const db = makeDb()
    seedDeviceRegistry(db, '')
    const registry = createDynamicRegistry(db, config)
    expect(registry.getDebounceMs('frigate')).toBe(300)
    expect(registry.getDebounceMs('raw')).toBeUndefined()
  })
})
