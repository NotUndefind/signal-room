import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('ioredis', async () => {
  const { default: RedisMock } = await import('ioredis-mock')
  return { default: RedisMock }
})

describe('Redis store', () => {
  beforeEach(async () => {
    vi.resetModules()
  })

  it('stocke et récupère un état device', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    await store.setDeviceState('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true, brightness: 80 },
      raw: '{"on":true}',
      timestamp: 1234567890,
    })

    const result = await store.getDeviceState('wled')
    expect(result?.source).toBe('wled')
    expect(result?.state).toEqual({ power: true, brightness: 80 })

    await store.quit()
  })

  it('retourne null si le device n\'existe pas', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    const result = await store.getDeviceState('unknown')
    expect(result).toBeNull()

    await store.quit()
  })

  it('retourne tous les états via getAllDeviceStates', async () => {
    const { createRedisStore } = await import('./redis')
    const store = createRedisStore('redis://localhost:6379')

    await store.setDeviceState('frigate', {
      source: 'frigate',
      event_type: 'detection_start',
      state: { person: true },
      raw: '{}',
      timestamp: 1234567890,
    })
    await store.setDeviceState('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: { power: false },
      raw: '{}',
      timestamp: 1234567890,
    })

    const all = await store.getAllDeviceStates()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all.frigate.state).toEqual({ person: true })

    await store.quit()
  })
})
