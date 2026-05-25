import { describe, it, expect, vi, beforeEach } from 'vitest'

class MockWebSocket {
  static OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((e: Event) => void) | null = null
  send = vi.fn()
  close = vi.fn()
}

vi.stubGlobal('WebSocket', MockWebSocket)

describe('createWsClient', () => {
  beforeEach(() => vi.clearAllMocks())

  it('appelle onSnapshot à la réception d\'un message snapshot', async () => {
    const { createWsClient } = await import('./ws')
    const onSnapshot = vi.fn()
    const onUpdate = vi.fn()

    const client = createWsClient({ url: 'ws://localhost:3001/ws', onSnapshot, onUpdate, onConnectionChange: vi.fn() })

    const ws = client.getSocket() as unknown as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ type: 'snapshot', data: { wled: { source: 'wled', event_type: 'state_change', state: {}, timestamp: 123 } } }) })

    expect(onSnapshot).toHaveBeenCalledOnce()
    expect(onSnapshot.mock.calls[0][0]).toHaveProperty('wled')
  })

  it('appelle onUpdate à la réception d\'un message update', async () => {
    const { createWsClient } = await import('./ws')
    const onUpdate = vi.fn()

    const client = createWsClient({ url: 'ws://localhost:3001/ws', onSnapshot: vi.fn(), onUpdate, onConnectionChange: vi.fn() })

    const ws = client.getSocket() as unknown as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ type: 'update', source: 'wled', state: { source: 'wled', event_type: 'state_change', state: { power: true }, timestamp: 456 } }) })

    expect(onUpdate).toHaveBeenCalledWith('wled', expect.objectContaining({ source: 'wled' }))
  })
})
