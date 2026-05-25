import { describe, it, expect, vi } from 'vitest'
import { createBroadcaster } from './server'
import type { DeviceState } from '../interpreters/types'

describe('createBroadcaster', () => {
  it('envoie un message à tous les clients connectés', () => {
    const broadcaster = createBroadcaster()

    const client1 = { readyState: 1, send: vi.fn() }
    const client2 = { readyState: 1, send: vi.fn() }
    broadcaster.addClient(client1 as never)
    broadcaster.addClient(client2 as never)

    const state: DeviceState = {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true },
      raw: '{}',
      timestamp: Date.now(),
    }
    broadcaster.broadcast('wled', state)

    expect(client1.send).toHaveBeenCalledOnce()
    expect(client2.send).toHaveBeenCalledOnce()

    const msg = JSON.parse(client1.send.mock.calls[0][0] as string)
    expect(msg.type).toBe('update')
    expect(msg.source).toBe('wled')
  })

  it('n\'envoie pas aux clients déconnectés (readyState !== 1)', () => {
    const broadcaster = createBroadcaster()
    const client = { readyState: 3, send: vi.fn() }
    broadcaster.addClient(client as never)

    broadcaster.broadcast('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: {},
      raw: '{}',
      timestamp: Date.now(),
    })

    expect(client.send).not.toHaveBeenCalled()
  })

  it('retire un client via removeClient', () => {
    const broadcaster = createBroadcaster()
    const client = { readyState: 1, send: vi.fn() }
    broadcaster.addClient(client as never)
    broadcaster.removeClient(client as never)

    broadcaster.broadcast('wled', {
      source: 'wled',
      event_type: 'state_change',
      state: {},
      raw: '{}',
      timestamp: Date.now(),
    })

    expect(client.send).not.toHaveBeenCalled()
  })
})
