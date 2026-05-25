import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { createDb } from '../db/client'
import { applySchema } from '../db/schema'
import { insertEvent } from '../db/queries'
import { registerHistoryRoutes } from './history'
import type Database from 'better-sqlite3'

describe('GET /api/events', () => {
  let app: ReturnType<typeof Fastify>
  let db: Database.Database

  beforeEach(async () => {
    db = createDb(':memory:')
    applySchema(db)
    app = Fastify()
    registerHistoryRoutes(app, db)
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    db.close()
  })

  it('retourne une liste vide', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/events' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toEqual([])
    expect(body.total).toBe(0)
  })

  it('retourne les events avec pagination', async () => {
    insertEvent(db, {
      source: 'wled',
      topic: 'wled/chambre/v',
      event_type: 'state_change',
      payload: '{"power":true}',
      raw: '{}',
      created_at: Date.now(),
    })

    const res = await app.inject({ method: 'GET', url: '/api/events?page=1&limit=10' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(1)
    expect(body.total).toBe(1)
  })

  it('filtre par source', async () => {
    insertEvent(db, { source: 'frigate', topic: 'f/c/events', event_type: 'detection_start', payload: '{}', raw: '{}', created_at: Date.now() })
    insertEvent(db, { source: 'wled', topic: 'wled/c/v', event_type: 'state_change', payload: '{}', raw: '{}', created_at: Date.now() })

    const res = await app.inject({ method: 'GET', url: '/api/events?source=frigate' })
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].source).toBe('frigate')
  })
})
