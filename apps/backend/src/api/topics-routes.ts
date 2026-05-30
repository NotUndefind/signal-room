import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { getTopicsSeen } from '../db/topics'

export function registerTopicsRoutes(fastify: FastifyInstance, db: Database.Database): void {
  fastify.get('/api/topics', async (req, reply) => {
    const { since } = req.query as { since?: string }
    const cutoff = since ? Date.now() - parseInt(since, 10) * 1000 : undefined
    const topics = getTopicsSeen(db, cutoff)
    return reply.send({ topics })
  })
}
