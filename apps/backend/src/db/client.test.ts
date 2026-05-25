import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createDb } from './client'
import { applySchema } from './schema'
import { insertEvent, queryEvents } from './queries'

describe('SQLite client', () => {
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    db = createDb(':memory:')
    applySchema(db)
  })

  afterEach(() => {
    db.close()
  })

  it('ouvre une base en mémoire', () => {
    expect(db).toBeDefined()
  })

  it('insère et lit un event', () => {
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: JSON.stringify({ power: true }),
      raw: '{"on":true}',
      created_at: Date.now(),
    })

    const events = queryEvents(db, { source: 'wled', limit: 10, page: 1 })
    expect(events.data).toHaveLength(1)
    expect(events.data[0].source).toBe('wled')
    expect(events.total).toBe(1)
  })

  it('filtre par source', () => {
    insertEvent(db, {
      source: 'frigate',
      topic: 'frigate/cam/events',
      event_type: 'detection_start',
      payload: '{}',
      raw: '{}',
      created_at: Date.now(),
    })
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: Date.now(),
    })

    const result = queryEvents(db, { source: 'frigate', limit: 10, page: 1 })
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
  })
})
