import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAggregator } from './aggregator'

describe('createAggregator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T12:00:00Z'))
  })

  it('produit un DeviceState avec event_type par défaut', () => {
    const agg = createAggregator()
    const state = agg.merge(1, { power: true }, '{"x":1}')
    expect(state.source).toBe('device:1')
    expect(state.event_type).toBe('state_change')
    expect(state.state).toEqual({ power: true })
    expect(state.raw).toBe('{"x":1}')
    expect(state.timestamp).toBeTypeOf('number')
  })

  it('persiste les champs non touchés entre messages', () => {
    const agg = createAggregator()
    agg.merge(1, { power: true, brightness: 80 }, 'raw1')
    const s = agg.merge(1, { brightness: 50 }, 'raw2')
    expect(s.state).toEqual({ power: true, brightness: 50 })
  })

  it('event_type d\'un unit pilote le event_type du DeviceState', () => {
    const agg = createAggregator()
    const s = agg.merge(1, { event_type: 'detection_start', object: 'person' }, 'raw')
    expect(s.event_type).toBe('detection_start')
    expect(s.state).toEqual({ object: 'person' })
    expect(s.state.event_type).toBeUndefined()
  })

  it('event_type persistant entre messages', () => {
    const agg = createAggregator()
    agg.merge(1, { event_type: 'detection_start', object: 'person' }, 'raw1')
    const s = agg.merge(1, { object: 'cat' }, 'raw2')
    expect(s.event_type).toBe('detection_start')
    expect(s.state.object).toBe('cat')
  })

  it('isolation entre devices', () => {
    const agg = createAggregator()
    agg.merge(1, { a: 1 }, 'r')
    agg.merge(2, { b: 2 }, 'r')
    expect(agg.getState(1)).toEqual({ a: 1 })
    expect(agg.getState(2)).toEqual({ b: 2 })
  })

  it('hydrate restaure un état (cas relecture Redis)', () => {
    const agg = createAggregator()
    agg.hydrate(1, { power: true, event_type: 'state_change' })
    const s = agg.merge(1, { brightness: 50 }, 'r')
    expect(s.state).toEqual({ power: true, brightness: 50 })
  })

  it('reset efface l\'état d\'un device', () => {
    const agg = createAggregator()
    agg.merge(1, { a: 1 }, 'r')
    agg.reset(1)
    expect(agg.getState(1)).toBeUndefined()
  })
})
