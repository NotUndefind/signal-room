import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import BetterSqlite3 from 'better-sqlite3'
import type Database from 'better-sqlite3'
import { applySchema } from '../db/schema'
import { registerCustomPresetsRoutes } from './custom-presets-routes'
import { registerPresetsRoutes } from './presets-routes'

function build(): { app: FastifyInstance; db: Database.Database } {
  const db = new BetterSqlite3(':memory:')
  applySchema(db)
  const app = Fastify()
  registerPresetsRoutes(app, db)
  registerCustomPresetsRoutes(app, db)
  return { app, db }
}

const samplePayload = {
  name: 'WLED ajusté',
  description: 'WLED avec bri scalé',
  units: [{
    position: 0,
    name: 'Power',
    topic_pattern: 'wled/lamp/v',
    json_path: 'on',
    condition: null,
    transform: { type: 'passthrough' },
    output_field: 'power',
    output_type: 'boolean',
    display: { label: 'Allumé' },
  }],
}

describe('POST /api/presets/custom', () => {
  it('crée un preset et retourne 201 + id', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'POST',
      url: '/api/presets/custom',
      payload: samplePayload,
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { id: string }
    expect(body.id).toMatch(/^custom_/)
  })

  it('retourne 400 si units invalides', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'POST',
      url: '/api/presets/custom',
      payload: { name: '', description: '', units: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/presets (merged)', () => {
  it('retourne built-in tagués source=builtin', async () => {
    const { app } = build()
    const res = await app.inject({ method: 'GET', url: '/api/presets' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { presets: Array<{ source: 'builtin' | 'custom' }> }
    expect(body.presets.length).toBeGreaterThan(0)
    expect(body.presets.every(p => p.source === 'builtin')).toBe(true)
  })

  it('inclut les presets custom après les built-in', async () => {
    const { app } = build()
    await app.inject({ method: 'POST', url: '/api/presets/custom', payload: samplePayload })
    const res = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = res.json() as { presets: Array<{ source: string; name: string }> }
    const sources = body.presets.map(p => p.source)
    expect(sources).toContain('custom')
    const custom = body.presets.find(p => p.source === 'custom')
    expect(custom?.name).toBe('WLED ajusté')
  })
})

describe('PATCH /api/presets/custom/:id', () => {
  it('met à jour un preset existant', async () => {
    const { app } = build()
    const created = await app.inject({
      method: 'POST', url: '/api/presets/custom', payload: samplePayload,
    })
    const { id } = created.json() as { id: string }
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/presets/custom/${id}`,
      payload: { ...samplePayload, name: 'WLED V2' },
    })
    expect(res.statusCode).toBe(200)
    const list = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = list.json() as { presets: Array<{ id?: string; name: string }> }
    expect(body.presets.find(p => p.id === id)?.name).toBe('WLED V2')
  })

  it('retourne 404 si id inconnu', async () => {
    const { app } = build()
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/presets/custom/custom_nope',
      payload: samplePayload,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/presets/custom/:id', () => {
  it('supprime un preset existant', async () => {
    const { app } = build()
    const created = await app.inject({
      method: 'POST', url: '/api/presets/custom', payload: samplePayload,
    })
    const { id } = created.json() as { id: string }
    const res = await app.inject({ method: 'DELETE', url: `/api/presets/custom/${id}` })
    expect(res.statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: '/api/presets' })
    const body = list.json() as { presets: Array<{ id?: string }> }
    expect(body.presets.find(p => p.id === id)).toBeUndefined()
  })

  it('retourne 404 si id inconnu', async () => {
    const { app } = build()
    const res = await app.inject({ method: 'DELETE', url: '/api/presets/custom/custom_nope' })
    expect(res.statusCode).toBe(404)
  })
})
