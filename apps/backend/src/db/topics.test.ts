import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { applySchema } from './schema'
import { upsertTopicSeen, getTopicsSeen } from './topics'

function makeDb() {
  const db = new Database(':memory:')
  applySchema(db)
  return db
}

describe('upsertTopicSeen', () => {
  it('insère un nouveau topic', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', 'tasmota')
    const rows = getTopicsSeen(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].topic).toBe('home/sensor')
    expect(rows[0].message_count).toBe(1)
    expect(rows[0].detected_type).toBe('tasmota')
  })

  it('met à jour last_seen et message_count pour un topic existant', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', null)
    upsertTopicSeen(db, 'home/sensor', 'frigate')
    const rows = getTopicsSeen(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].message_count).toBe(2)
  })

  it('ne réinitialise pas detected_type si déjà connu', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'home/sensor', 'wled')
    upsertTopicSeen(db, 'home/sensor', null)
    const rows = getTopicsSeen(db)
    expect(rows[0].detected_type).toBe('wled')
  })
})

describe('getTopicsSeen', () => {
  it('retourne tous les topics sans filtre', () => {
    const db = makeDb()
    upsertTopicSeen(db, 'a', null)
    upsertTopicSeen(db, 'b', null)
    expect(getTopicsSeen(db)).toHaveLength(2)
  })

  it('filtre par cutoff', () => {
    const db = makeDb()
    const old = Date.now() - 100_000
    db.prepare(`INSERT INTO topics_seen (topic, first_seen, last_seen, message_count) VALUES (?, ?, ?, 1)`)
      .run('old/topic', old, old)
    upsertTopicSeen(db, 'recent/topic', null)
    const cutoff = Date.now() - 10_000
    const rows = getTopicsSeen(db, cutoff)
    expect(rows.map(r => r.topic)).toContain('recent/topic')
    expect(rows.map(r => r.topic)).not.toContain('old/topic')
  })
})
