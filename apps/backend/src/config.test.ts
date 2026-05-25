import { describe, it, expect, beforeEach } from 'vitest'

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.MQTT_HOST
    delete process.env.MQTT_PORT
    delete process.env.REDIS_URL
    delete process.env.DB_PATH
    delete process.env.RETENTION_DAYS
    delete process.env.FRIGATE_DEBOUNCE_MS
    delete process.env.BACKEND_PORT
  })

  it('utilise les valeurs par défaut', async () => {
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('localhost')
    expect(config.mqtt.port).toBe(1883)
    expect(config.redis.url).toBe('redis://localhost:6379')
    expect(config.db.path).toBe('./signal-room.db')
    expect(config.retention.days).toBe(30)
    expect(config.frigate.debounceMs).toBe(300)
    expect(config.port).toBe(3001)
  })

  it('lit les variables d\'environnement', async () => {
    process.env.MQTT_HOST = '192.168.1.50'
    process.env.MQTT_PORT = '1884'
    process.env.RETENTION_DAYS = '7'
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('192.168.1.50')
    expect(config.mqtt.port).toBe(1884)
    expect(config.retention.days).toBe(7)
  })
})
