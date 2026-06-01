import { describe, it, expect } from 'vitest'
import { validateUnitInput, validateDevicePayload } from './validate'

const baseUnit = {
  position: 0,
  name: 'u',
  topic_pattern: 'home/test',
  json_path: null,
  condition: null,
  transform: { type: 'passthrough' },
  output_field: 'value',
  output_type: 'string',
  display: null,
}

describe('validateUnitInput', () => {
  it('accepte un unit minimal valide', () => {
    const r = validateUnitInput(baseUnit)
    expect(r.ok).toBe(true)
  })

  it('refuse topic_pattern vide', () => {
    const r = validateUnitInput({ ...baseUnit, topic_pattern: '' })
    expect(r.ok).toBe(false)
  })

  it('refuse topic_pattern avec # au milieu', () => {
    const r = validateUnitInput({ ...baseUnit, topic_pattern: 'a/#/b' })
    expect(r.ok).toBe(false)
  })

  it('accepte topic_pattern avec + et # en fin', () => {
    expect(validateUnitInput({ ...baseUnit, topic_pattern: 'home/+/state' }).ok).toBe(true)
    expect(validateUnitInput({ ...baseUnit, topic_pattern: 'home/#' }).ok).toBe(true)
  })

  it('refuse json_path invalide', () => {
    expect(validateUnitInput({ ...baseUnit, json_path: '..a' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, json_path: 'a..b' }).ok).toBe(false)
  })

  it('accepte json_path simple et indexé', () => {
    expect(validateUnitInput({ ...baseUnit, json_path: 'a.b' }).ok).toBe(true)
    expect(validateUnitInput({ ...baseUnit, json_path: 'seg[0].col[0]' }).ok).toBe(true)
  })

  it('refuse output_field invalide', () => {
    expect(validateUnitInput({ ...baseUnit, output_field: '1bad' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, output_field: 'bad-name' }).ok).toBe(false)
    expect(validateUnitInput({ ...baseUnit, output_field: '' }).ok).toBe(false)
  })

  it('refuse output_type hors whitelist', () => {
    expect(validateUnitInput({ ...baseUnit, output_type: 'date' }).ok).toBe(false)
  })

  it('refuse transform.type inconnu', () => {
    expect(validateUnitInput({ ...baseUnit, transform: { type: 'eval' } }).ok).toBe(false)
  })

  it('refuse scale sans bornes', () => {
    const r = validateUnitInput({ ...baseUnit, transform: { type: 'scale', in_min: 0 } })
    expect(r.ok).toBe(false)
  })

  it('refuse condition op inconnu', () => {
    const r = validateUnitInput({
      ...baseUnit,
      condition: { path: 'a', op: 'matches', value: 'x' },
    })
    expect(r.ok).toBe(false)
  })

  it('refuse event_type avec output_type incompatible', () => {
    const r = validateUnitInput({
      ...baseUnit,
      output_field: 'event_type',
      output_type: 'number',
    })
    expect(r.ok).toBe(false)
  })

  it('accepte event_type en string', () => {
    expect(validateUnitInput({
      ...baseUnit,
      output_field: 'event_type',
      output_type: 'string',
    }).ok).toBe(true)
  })
})

describe('validateDevicePayload', () => {
  const baseDevice = {
    name: 'd',
    units: [baseUnit],
  }

  it('accepte un device minimal', () => {
    expect(validateDevicePayload(baseDevice).ok).toBe(true)
  })

  it('refuse name vide', () => {
    expect(validateDevicePayload({ ...baseDevice, name: '' }).ok).toBe(false)
  })

  it('refuse units vide', () => {
    expect(validateDevicePayload({ ...baseDevice, units: [] }).ok).toBe(false)
  })

  it('refuse plus de 30 units', () => {
    const many = Array.from({ length: 31 }, () => baseUnit)
    expect(validateDevicePayload({ ...baseDevice, units: many }).ok).toBe(false)
  })

  it('refuse incohérence d\'output_type entre units même field', () => {
    const r = validateDevicePayload({
      ...baseDevice,
      units: [
        { ...baseUnit, output_field: 'x', output_type: 'string' },
        { ...baseUnit, output_field: 'x', output_type: 'number' },
      ],
    })
    expect(r.ok).toBe(false)
  })

  it('accepte plusieurs units sur le même output_field si même type', () => {
    const r = validateDevicePayload({
      ...baseDevice,
      units: [
        { ...baseUnit, output_field: 'x', output_type: 'string' },
        { ...baseUnit, output_field: 'x', output_type: 'string', position: 1 },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('accepte debounce_ms', () => {
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: 200 }).ok).toBe(true)
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: null }).ok).toBe(true)
  })

  it('refuse debounce_ms négatif', () => {
    expect(validateDevicePayload({ ...baseDevice, debounce_ms: -1 }).ok).toBe(false)
  })
})
