import { describe, it, expect } from 'vitest'
import type { DeviceState } from './types'

describe('DeviceState type', () => {
  it('accepte un état valide', () => {
    const state: DeviceState = {
      source: 'frigate',
      event_type: 'detection_start',
      state: { object: 'person', zone: 'chambre' },
      raw: '{"type":"new"}',
      timestamp: Date.now(),
    }
    expect(state.source).toBe('frigate')
    expect(state.timestamp).toBeTypeOf('number')
  })
})
