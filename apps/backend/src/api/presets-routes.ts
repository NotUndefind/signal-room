import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { PRESETS } from '../interpreters/presets'
import { listCustomPresets } from '../db/custom-presets'

export function registerPresetsRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
): void {
  fastify.get('/api/presets', async (_req, reply) => {
    const builtin = PRESETS.map(p => ({ ...p, source: 'builtin' as const }))
    const custom = listCustomPresets(db).map(p => ({
      key: p.id,
      id: p.id,
      name: p.name,
      description: p.description,
      debounce_ms: p.debounce_ms,
      layout: p.layout,
      placeholders: [] as string[],
      units: p.units,
      source: 'custom' as const,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }))
    return reply.send({ presets: [...builtin, ...custom] })
  })
}
