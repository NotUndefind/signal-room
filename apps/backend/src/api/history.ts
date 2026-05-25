import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import { queryEvents } from '../db/queries'

interface EventQueryParams {
  source?: string
  event_type?: string
  from?: string
  to?: string
  page?: string
  limit?: string
}

export function registerHistoryRoutes(fastify: FastifyInstance, db: Database.Database): void {
  fastify.get<{ Querystring: EventQueryParams }>('/api/events', async (req, reply) => {
    const {
      source,
      event_type,
      from,
      to,
      page = '1',
      limit = '50',
    } = req.query

    const result = queryEvents(db, {
      source,
      event_type,
      from: from ? parseInt(from, 10) : undefined,
      to: to ? parseInt(to, 10) : undefined,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 200),
    })

    return reply.send(result)
  })
}
