import { describe, it, expect } from 'vitest'
import type { DeviceState, Interpreter } from './types'

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

describe('Interpreter interface', () => {
  it('un interpréteur valide est compilable', () => {
    const interp: Interpreter = {
      source: 'test',
      topics: ['test/+/events'],
      debounceMs: 100,
      parse: (_topic, _payload) => null,
    }
    expect(interp.topics).toHaveLength(1)
    expect(interp.debounceMs).toBe(100)
  })

  it('debounceMs est optionnel', () => {
    const interp: Interpreter = {
      source: 'test',
      topics: ['test/topic'],
      parse: () => null,
    }
    expect(interp.debounceMs).toBeUndefined()
  })
})
