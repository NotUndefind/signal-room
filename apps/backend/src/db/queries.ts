import type Database from 'better-sqlite3'

interface InsertEventParams {
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

interface QueryEventsParams {
  source?: string
  event_type?: string
  from?: number
  to?: number
  page: number
  limit: number
}

interface EventRow {
  id: number
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

export function insertEvent(db: Database.Database, params: InsertEventParams): void {
  db.prepare(`
    INSERT INTO events (source, topic, event_type, payload, raw, created_at)
    VALUES (@source, @topic, @event_type, @payload, @raw, @created_at)
  `).run(params)
}

export function insertSnapshot(db: Database.Database, source: string, state: string): void {
  db.prepare(`
    INSERT INTO device_snapshots (source, state, created_at)
    VALUES (?, ?, ?)
  `).run(source, state, Date.now())
}

export function queryEvents(
  db: Database.Database,
  params: QueryEventsParams
): { data: EventRow[]; total: number } {
  const conditions: string[] = []
  const bindings: Record<string, unknown> = {}

  if (params.source) {
    conditions.push('source = @source')
    bindings.source = params.source
  }
  if (params.event_type) {
    conditions.push('event_type = @event_type')
    bindings.event_type = params.event_type
  }
  if (params.from) {
    conditions.push('created_at >= @from')
    bindings.from = params.from
  }
  if (params.to) {
    conditions.push('created_at <= @to')
    bindings.to = params.to
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (params.page - 1) * params.limit

  const total = (db.prepare(`SELECT COUNT(*) as count FROM events ${where}`).get(bindings) as { count: number }).count
  const data = db.prepare(`
    SELECT * FROM events ${where}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...bindings, limit: params.limit, offset }) as EventRow[]

  return { data, total }
}

export function deleteOldEvents(db: Database.Database, beforeTimestamp: number): number {
  const result = db.prepare('DELETE FROM events WHERE created_at < ?').run(beforeTimestamp)
  return result.changes
}
