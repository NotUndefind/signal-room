export interface Config {
  mqtt: { host: string; port: number }
  redis: { url: string }
  db: { path: string }
  retention: { days: number }
  frigate: { debounceMs: number }
  port: number
}

export function loadConfig(): Config {
  return {
    mqtt: {
      host: process.env.MQTT_HOST ?? 'localhost',
      port: parseInt(process.env.MQTT_PORT ?? '1883', 10),
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
    port: parseInt(process.env.BACKEND_PORT ?? '3001', 10),
  }
}

export const config = loadConfig()
