import { describe, it, expect, beforeEach } from 'vitest'
import { useRoomStore } from './room'

describe('useRoomStore', () => {
  beforeEach(() => {
    useRoomStore.setState({ devices: {}, connected: false })
  })

  it('commence déconnecté sans devices', () => {
    const { devices, connected } = useRoomStore.getState()
    expect(connected).toBe(false)
    expect(devices).toEqual({})
  })

  it('setConnected met à jour l\'état de connexion', () => {
    useRoomStore.getState().setConnected(true)
    expect(useRoomStore.getState().connected).toBe(true)
  })

  it('setDevice ajoute un device', () => {
    const state = {
      source: 'wled',
      event_type: 'state_change',
      state: { power: true, brightness: 80 },
      timestamp: Date.now(),
    }
    useRoomStore.getState().setDevice('wled', state)
    expect(useRoomStore.getState().devices.wled).toEqual(state)
  })

  it('setDevices remplace tous les devices (snapshot initial)', () => {
    const snapshot = {
      frigate: { source: 'frigate', event_type: 'detection_start', state: { person: true }, timestamp: 123 },
      wled: { source: 'wled', event_type: 'state_change', state: { power: false }, timestamp: 456 },
    }
    useRoomStore.getState().setDevices(snapshot)
    expect(Object.keys(useRoomStore.getState().devices)).toHaveLength(2)
  })
})
