import type { FastifyInstance } from 'fastify'
import { PRESETS } from '../interpreters/presets'

export function registerPresetsRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/presets', async (_req, reply) => {
    return reply.send({ presets: PRESETS })
  })
}
