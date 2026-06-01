import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('mqtt', () => ({
  connect: vi.fn(() => ({
    on: vi.fn(),
    subscribe: vi.fn((_topics, _opts, cb) => cb && cb(null)),
    end: vi.fn(),
  })),
}))

describe('createMqttClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('se connecte au broker et souscrit aux topics', async () => {
    const mqtt = await import('mqtt')
    const { createMqttClient } = await import('./client')

    const onMessage = vi.fn()
    createMqttClient({
      host: 'localhost',
      port: 1883,
      topics: ['frigate/+/events', 'wled/+/v'],
      onMessage,
    })

    expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:1883')
  })
})
