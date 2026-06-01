import { describe, it, expect } from 'vitest'
import { createUnitRegistry } from './registry'
import type { DeviceEntry, UnitInput } from './types'

let nextId = 1
function makeDevice(name: string, units: UnitInput[], debounceMs: number | null = null): DeviceEntry {
  return {
    id: nextId++,
    name,
    debounce_ms: debounceMs,
    layout: null,
    units: units.map((u, i) => ({ ...u, id: i + 1, device_id: nextId - 1 })),
    active: true,
    created_at: Date.now(),
  }
}

const tasmotaUnits: UnitInput[] = [
  {
    position: 0, name: 'Power',
    topic_pattern: 'tele/chambre/STATE',
    json_path: 'POWER', condition: null,
    transform: { type: 'enum_map', map: { ON: true, OFF: false } },
    output_field: 'power', output_type: 'boolean', display: null,
  },
]

describe('createUnitRegistry.route', () => {
  it('match topic exact + extraction + transform', () => {
    const reg = createUnitRegistry([makeDevice('Lampe', tasmotaUnits)])
    const results = reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))
    expect(results).toHaveLength(1)
    expect(results[0].partial_state).toEqual({ power: true })
  })

  it('aucun match → []', () => {
    const reg = createUnitRegistry([makeDevice('Lampe', tasmotaUnits)])
    expect(reg.route('other/topic', Buffer.from('{}'))).toEqual([])
  })

  it('plusieurs units du même device s\'agrègent dans un seul partial_state', () => {
    const units: UnitInput[] = [
      { position: 0, name: 'a', topic_pattern: 'home/x', json_path: 'a', condition: null,
        transform: { type: 'passthrough' }, output_field: 'a', output_type: 'number', display: null },
      { position: 1, name: 'b', topic_pattern: 'home/x', json_path: 'b', condition: null,
        transform: { type: 'passthrough' }, output_field: 'b', output_type: 'number', display: null },
    ]
    const reg = createUnitRegistry([makeDevice('D', units)])
    const r = reg.route('home/x', Buffer.from('{"a":1,"b":2}'))
    expect(r).toHaveLength(1)
    expect(r[0].partial_state).toEqual({ a: 1, b: 2 })
  })

  it('payload non-JSON → utilisé comme string brute', () => {
    const units: UnitInput[] = [
      { position: 0, name: 'p', topic_pattern: 'home/y', json_path: null, condition: null,
        transform: { type: 'passthrough' }, output_field: 'value', output_type: 'string', display: null },
    ]
    const reg = createUnitRegistry([makeDevice('D', units)])
    const r = reg.route('home/y', Buffer.from('plaintext'))
    expect(r[0].partial_state.value).toBe('plaintext')
  })

  it('device inactif n\'est pas routé', () => {
    const d = makeDevice('D', tasmotaUnits)
    d.active = false
    const reg = createUnitRegistry([d])
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
  })

  it('addDevice ajoute à chaud', () => {
    const reg = createUnitRegistry([])
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
    reg.addDevice(makeDevice('Lampe', tasmotaUnits))
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toHaveLength(1)
  })

  it('removeDevice retire à chaud', () => {
    const d = makeDevice('Lampe', tasmotaUnits)
    const reg = createUnitRegistry([d])
    reg.removeDevice(d.id)
    expect(reg.route('tele/chambre/STATE', Buffer.from('{"POWER":"ON"}'))).toEqual([])
  })

  it('getAllTopics retourne l\'union des topic_patterns actifs', () => {
    const reg = createUnitRegistry([
      makeDevice('A', tasmotaUnits),
      makeDevice('B', [{ ...tasmotaUnits[0], topic_pattern: 'home/lamp/v' }]),
    ])
    expect(reg.getAllTopics().sort()).toEqual(['home/lamp/v', 'tele/chambre/STATE'])
  })

  it('getDebounceMs retourne null si non défini', () => {
    const d = makeDevice('A', tasmotaUnits, null)
    const reg = createUnitRegistry([d])
    expect(reg.getDebounceMs(d.id)).toBeNull()
  })

  it('getDebounceMs retourne la valeur du device', () => {
    const d = makeDevice('A', tasmotaUnits, 200)
    const reg = createUnitRegistry([d])
    expect(reg.getDebounceMs(d.id)).toBe(200)
  })
})
