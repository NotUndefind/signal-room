import type Database from 'better-sqlite3'
import { deleteOldEvents } from './queries'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionJob {
  runOnce(): void
  start(): void
  stop(): void
}

export function createRetentionJob(db: Database.Database, retentionDays: number): RetentionJob {
  let timer: ReturnType<typeof setInterval> | null = null

  const job: RetentionJob = {
    runOnce() {
      const cutoff = Date.now() - retentionDays * ONE_DAY_MS
      const deleted = deleteOldEvents(db, cutoff)
      if (deleted > 0) {
        console.log(`[Retention] Deleted ${deleted} events older than ${retentionDays} days`)
      }
    },

    start() {
      timer = setInterval(() => job.runOnce(), ONE_DAY_MS)
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }

  return job
}
