import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const originalCwd = process.cwd()

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.MQTT_HOST
    delete process.env.MQTT_PORT
    delete process.env.MQTT_USER
    delete process.env.MQTT_PASS
    delete process.env.REDIS_URL
    delete process.env.DB_PATH
    delete process.env.RETENTION_DAYS
    delete process.env.FRIGATE_DEBOUNCE_MS
    delete process.env.BACKEND_PORT
  })

  afterEach(() => {
    process.chdir(originalCwd)
  })

  it('utilise les valeurs par défaut', async () => {
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('localhost')
    expect(config.mqtt.port).toBe(1883)
    expect(config.mqtt.username).toBe('mqtt_nlp')
    expect(config.mqtt.password).toBeUndefined()
    expect(config.redis.url).toBe('redis://localhost:6379')
    expect(config.db.path).toBe('./signal-room.db')
    expect(config.retention.days).toBe(30)
    expect(config.frigate.debounceMs).toBe(300)
    expect(config.port).toBe(3001)
  })

  it('lit les variables d\'environnement', async () => {
    process.env.MQTT_HOST = '192.168.1.50'
    process.env.MQTT_PORT = '1884'
    process.env.MQTT_USER = 'mqtt_custom'
    process.env.MQTT_PASS = 'secret'
    process.env.RETENTION_DAYS = '7'
    const { loadConfig } = await import('./config')
    const config = loadConfig()
    expect(config.mqtt.host).toBe('192.168.1.50')
    expect(config.mqtt.port).toBe(1884)
    expect(config.mqtt.username).toBe('mqtt_custom')
    expect(config.mqtt.password).toBe('secret')
    expect(config.retention.days).toBe(7)
  })

  it('charge les variables depuis un fichier .env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'signal-room-config-'))
    writeFileSync(
      join(dir, '.env'),
      [
        'MQTT_HOST=10.0.0.25',
        'MQTT_PORT=1885',
        'MQTT_USER=mqtt_from_env',
        'MQTT_PASS=from_env',
      ].join('\n'),
    )
    process.chdir(dir)

    const { loadEnv, loadConfig } = await import('./config')
    loadEnv()
    const config = loadConfig()

    expect(config.mqtt.host).toBe('10.0.0.25')
    expect(config.mqtt.port).toBe(1885)
    expect(config.mqtt.username).toBe('mqtt_from_env')
    expect(config.mqtt.password).toBe('from_env')
  })
})
