import { describe, it, expect } from 'vitest'
import { createDedupStore } from './dedup'
import type { DeviceState } from '../interpreters/types'

const makeState = (source: string, overrides: Partial<DeviceState> = {}): DeviceState => ({
  source,
  event_type: 'state_change',
  state: { power: true },
  raw: '{}',
  timestamp: Date.now(),
  ...overrides,
})

describe('DedupStore', () => {
  it('retourne true si c\'est un nouvel état (aucune entrée préalable)', () => {
    const store = createDedupStore()
    const state = makeState('wled')
    expect(store.hasChanged('wled', state)).toBe(true)
  })

  it('retourne false si l\'état est identique', () => {
    const store = createDedupStore()
    const state = makeState('wled', { state: { power: true, brightness: 80 } })
    store.update('wled', state)
    const same = makeState('wled', { state: { power: true, brightness: 80 } })
    expect(store.hasChanged('wled', same)).toBe(false)
  })

  it('retourne true si l\'état a changé', () => {
    const store = createDedupStore()
    const state = makeState('wled', { state: { power: true } })
    store.update('wled', state)
    const changed = makeState('wled', { state: { power: false } })
    expect(store.hasChanged('wled', changed)).toBe(true)
  })

  it('met à jour l\'état en mémoire', () => {
    const store = createDedupStore()
    store.update('frigate', makeState('frigate', { state: { person: false } }))
    store.update('frigate', makeState('frigate', { state: { person: true } }))
    expect(store.hasChanged('frigate', makeState('frigate', { state: { person: true } }))).toBe(false)
  })

  it('isole les clés par device (multi-caméra)', () => {
    const store = createDedupStore()
    const stateA = makeState('frigate', { state: { active: true, camera: 'principale' } })
    const stateB = makeState('frigate', { state: { active: true, camera: 'chambre' } })
    store.update('frigate:principale', stateA)
    expect(store.hasChanged('frigate:chambre', stateB)).toBe(true)
  })
})
