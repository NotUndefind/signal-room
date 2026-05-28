import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotEnv } from 'dotenv'

export interface Config {
  mqtt: { host: string; port: number; username: string; password?: string }
  redis: { url: string }
  db: { path: string }
  retention: { days: number }
  frigate: { debounceMs: number }
  tasmota: { topicPrefix: string }
  port: number
}

export function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
  ]
  const envPath = candidates.find((path) => existsSync(path))
  if (envPath) loadDotEnv({ path: envPath })
}

export function loadConfig(): Config {
  return {
    mqtt: {
      host: process.env.MQTT_HOST ?? 'localhost',
      port: parseInt(process.env.MQTT_PORT ?? '1883', 10),
      username: process.env.MQTT_USER ?? 'mqtt_nlp',
      password: process.env.MQTT_PASS || undefined,
    },
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
    db: {
      path: process.env.DB_PATH ?? './signal-room.db',
    },
    retention: {
      days: parseInt(process.env.RETENTION_DAYS ?? '30', 10),
    },
    frigate: {
      debounceMs: parseInt(process.env.FRIGATE_DEBOUNCE_MS ?? '300', 10),
    },
    tasmota: {
      topicPrefix: process.env.TASMOTA_TOPIC_PREFIX ?? '',
    },
    port: parseInt(process.env.BACKEND_PORT ?? '3001', 10),
  }
}

if (process.env.NODE_ENV !== 'test') loadEnv()
export const config = loadConfig()
