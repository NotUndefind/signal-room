import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { UnitRegistry } from '../interpreters/registry'
import {
  getAllDevices, getDeviceById, insertDeviceWithUnits, deleteDevice,
  replaceDeviceUnits, updateDeviceMeta,
} from '../db/registry'
import { validateDevicePayload } from '../interpreters/validate'

export function registerRegistryRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  registry: UnitRegistry,
): void {
  fastify.get('/api/registry', async (_req, reply) => {
    return reply.send({ devices: getAllDevices(db) })
  })

  fastify.post('/api/registry', async (req, reply) => {
    const res = validateDevicePayload(req.body)
    if (!res.ok) return reply.status(400).send({ error: res.error })

    const id = insertDeviceWithUnits(db, {
      name: res.value.name,
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
      units: res.value.units,
    })
    const created = getDeviceById(db, id)
    if (created) registry.addDevice(created)

    return reply.status(201).send({ id })
  })

  fastify.patch('/api/registry/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.status(400).send({ error: 'id invalide' })

    const existing = getDeviceById(db, id)
    if (!existing) return reply.status(404).send({ error: 'Device introuvable' })

    const res = validateDevicePayload(req.body)
    if (!res.ok) return reply.status(400).send({ error: res.error })

    updateDeviceMeta(db, id, {
      name: res.value.name,
      debounce_ms: res.value.debounce_ms ?? null,
      layout: res.value.layout ?? null,
    })
    replaceDeviceUnits(db, id, res.value.units)

    const updated = getDeviceById(db, id)
    if (updated) registry.replaceDevice(updated)

    return reply.send({ ok: true })
  })

  fastify.delete('/api/registry/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.status(400).send({ error: 'id invalide' })
    const deleted = deleteDevice(db, id)
    if (!deleted) return reply.status(404).send({ error: 'Device introuvable' })
    registry.removeDevice(id)
    return reply.status(204).send()
  })
}
