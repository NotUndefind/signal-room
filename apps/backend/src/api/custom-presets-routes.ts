import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import {
  insertCustomPreset, updateCustomPreset, deleteCustomPreset,
} from '../db/custom-presets'
import { validateDevicePayload } from '../interpreters/validate'

export function registerCustomPresetsRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
): void {
  fastify.post('/api/presets/custom', async (req, reply) => {
    const body = req.body as { name?: string; description?: string; units?: unknown }
    const res = validateDevicePayload({ name: body.name, units: body.units })
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const id = insertCustomPreset(db, {
      name: res.value.name,
      description: typeof body.description === 'string' ? body.description : '',
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
      units: res.value.units,
    })
    return reply.status(201).send({ id })
  })

  fastify.patch('/api/presets/custom/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; description?: string; units?: unknown }
    const res = validateDevicePayload({ name: body.name, units: body.units })
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const ok = updateCustomPreset(db, id, {
      name: res.value.name,
      description: typeof body.description === 'string' ? body.description : '',
      units: res.value.units,
    })
    if (!ok) return reply.status(404).send({ error: 'Preset introuvable' })
    return reply.send({ ok: true })
  })

  fastify.delete('/api/presets/custom/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = deleteCustomPreset(db, id)
    if (!ok) return reply.status(404).send({ error: 'Preset introuvable' })
    return reply.status(204).send()
  })
}
