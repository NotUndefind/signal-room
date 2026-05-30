import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { DynamicRegistry } from '../interpreters/dynamic'
import type { DeviceEntry } from '../db/registry'
import { getAllDevices, insertDevice, deleteDevice } from '../db/registry'

const VALID_TYPES = ['frigate', 'tasmota', 'wled', 'raw'] as const

export function registerRegistryRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  registry: DynamicRegistry
): void {
  fastify.get('/api/registry', async (_req, reply) => {
    return reply.send({ devices: getAllDevices(db) })
  })

  fastify.post('/api/registry', async (req, reply) => {
    const body = req.body as { name?: unknown; topic_patterns?: unknown; interpreter_type?: unknown }
    const { name, topic_patterns, interpreter_type } = body

    if (
      typeof name !== 'string' || !name ||
      !Array.isArray(topic_patterns) || topic_patterns.length === 0 ||
      typeof interpreter_type !== 'string' ||
      !(VALID_TYPES as readonly string[]).includes(interpreter_type)
    ) {
      return reply.status(400).send({
        error: 'name (string), topic_patterns (array non-vide) et interpreter_type valide requis',
      })
    }

    const id = insertDevice(db, {
      name,
      topic_patterns: topic_patterns as string[],
      interpreter_type,
    })

    const entry: DeviceEntry = {
      id,
      name,
      topic_patterns: topic_patterns as string[],
      interpreter_type: interpreter_type as DeviceEntry['interpreter_type'],
      active: 1,
      created_at: Date.now(),
    }
    registry.addDevice(entry)

    return reply.status(201).send({ id })
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
