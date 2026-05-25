import type { FastifyInstance } from 'fastify'
import type { RedisStore } from '../store/redis'

export function registerDeviceRoutes(fastify: FastifyInstance, redisStore: RedisStore): void {
  fastify.get('/api/devices', async (_req, reply) => {
    const devices = await redisStore.getAllDeviceStates()
    return reply.send({ devices })
  })
}
