import type Database from 'better-sqlite3'

export interface TopicSeenRow {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export function upsertTopicSeen(
  db: Database.Database,
  topic: string,
  detectedType: string | null
): void {
  const now = Date.now()
  db.prepare(`
    INSERT INTO topics_seen (topic, first_seen, last_seen, message_count, detected_type)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(topic) DO UPDATE SET
      last_seen = excluded.last_seen,
      message_count = message_count + 1,
      detected_type = COALESCE(excluded.detected_type, topics_seen.detected_type)
  `).run(topic, now, now, detectedType)
}

export function getTopicsSeen(
  db: Database.Database,
  cutoff?: number
): TopicSeenRow[] {
  if (cutoff !== undefined) {
    return db.prepare(
      'SELECT * FROM topics_seen WHERE last_seen >= ? ORDER BY last_seen DESC'
    ).all(cutoff) as TopicSeenRow[]
  }
  return db.prepare(
    'SELECT * FROM topics_seen ORDER BY last_seen DESC'
  ).all() as TopicSeenRow[]
}
