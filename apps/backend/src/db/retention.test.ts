import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDb } from './client'
import { applySchema } from './schema'
import { insertEvent } from './queries'
import { createRetentionJob } from './retention'
import type Database from 'better-sqlite3'

describe('RetentionJob', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createDb(':memory:')
    applySchema(db)
    vi.useFakeTimers()
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('supprime les events plus vieux que retentionDays', () => {
    const now = Date.now()
    const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000

    insertEvent(db, {
      source: 'wled',
      topic: 'wled/c/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: thirtyOneDaysAgo,
    })
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/c/v',
      event_type: 'state_change',
      payload: '{}',
      raw: '{}',
      created_at: now,
    })

    const job = createRetentionJob(db, 30)
    job.runOnce()

    const remaining = db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number }
    expect(remaining.count).toBe(1)
  })

  it('planifie l\'exécution toutes les 24h', () => {
    const job = createRetentionJob(db, 30)
    const spy = vi.spyOn(job, 'runOnce')
    job.start()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(spy).toHaveBeenCalledOnce()
    job.stop()
  })
})
