import { describe, it, expect } from 'vitest'
import { getByPath, evalCondition, applyTransform, evalUnit } from './eval'
import type { Unit } from './types'

describe('getByPath', () => {
  it('retourne le payload entier si path null', () => {
    expect(getByPath({ a: 1 }, null)).toEqual({ a: 1 })
  })

  it('extrait un champ simple', () => {
    expect(getByPath({ a: 42 }, 'a')).toBe(42)
  })

  it('extrait un champ imbriqué', () => {
    expect(getByPath({ a: { b: { c: 'x' } } }, 'a.b.c')).toBe('x')
  })

  it('extrait un index de tableau', () => {
    expect(getByPath({ arr: [10, 20, 30] }, 'arr[1]')).toBe(20)
  })

  it('extrait imbriqué array+object', () => {
    expect(getByPath({ seg: [{ col: [[255, 100, 0]] }] }, 'seg[0].col[0]')).toEqual([255, 100, 0])
  })

  it('retourne undefined si chemin inexistant', () => {
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined()
  })

  it('retourne undefined si traversée d\'un null', () => {
    expect(getByPath({ a: null }, 'a.b')).toBeUndefined()
  })
})

describe('evalCondition', () => {
  const payload = { type: 'new', zones: ['bureau', 'salon'], score: 0.87 }

  it('null condition → true', () => {
    expect(evalCondition(payload, null)).toBe(true)
  })

  it('eq', () => {
    expect(evalCondition(payload, { path: 'type', op: 'eq', value: 'new' })).toBe(true)
    expect(evalCondition(payload, { path: 'type', op: 'eq', value: 'end' })).toBe(false)
  })

  it('neq', () => {
    expect(evalCondition(payload, { path: 'type', op: 'neq', value: 'update' })).toBe(true)
  })

  it('in', () => {
    expect(evalCondition(payload, { path: 'type', op: 'in', value: ['new', 'end'] })).toBe(true)
    expect(evalCondition(payload, { path: 'type', op: 'in', value: ['end'] })).toBe(false)
  })

  it('contains sur array', () => {
    expect(evalCondition(payload, { path: 'zones', op: 'contains', value: 'bureau' })).toBe(true)
    expect(evalCondition(payload, { path: 'zones', op: 'contains', value: 'cuisine' })).toBe(false)
  })

  it('contains sur string', () => {
    expect(evalCondition({ s: 'hello world' }, { path: 's', op: 'contains', value: 'world' })).toBe(true)
  })

  it('gt / gte / lt / lte', () => {
    expect(evalCondition(payload, { path: 'score', op: 'gt', value: 0.5 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'gte', value: 0.87 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'lt', value: 1 })).toBe(true)
    expect(evalCondition(payload, { path: 'score', op: 'lte', value: 0.87 })).toBe(true)
  })

  it('chemin inexistant → false (défensif)', () => {
    expect(evalCondition(payload, { path: 'missing', op: 'eq', value: 'x' })).toBe(false)
  })
})

describe('applyTransform', () => {
  it('passthrough', () => {
    expect(applyTransform(42, { type: 'passthrough' })).toBe(42)
    expect(applyTransform({ x: 1 }, { type: 'passthrough' })).toEqual({ x: 1 })
  })

  it('enum_map avec match', () => {
    expect(applyTransform('ON', { type: 'enum_map', map: { ON: true, OFF: false } })).toBe(true)
  })

  it('enum_map avec default', () => {
    expect(applyTransform('UNKNOWN', { type: 'enum_map', map: { ON: true }, default: false })).toBe(false)
  })

  it('enum_map sans match et sans default → undefined', () => {
    expect(applyTransform('X', { type: 'enum_map', map: { ON: true } })).toBeUndefined()
  })

  it('scale 0-255 → 0-100 round', () => {
    expect(applyTransform(128, { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true })).toBe(50)
  })

  it('scale sans round', () => {
    const v = applyTransform(127, { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100 }) as number
    expect(v).toBeCloseTo(49.8, 1)
  })

  it('scale jette si non numérique', () => {
    expect(() => applyTransform('abc', { type: 'scale', in_min: 0, in_max: 1, out_min: 0, out_max: 1 })).toThrow()
  })

  it('round', () => {
    expect(applyTransform(0.876, { type: 'round', decimals: 2 })).toBe(0.88)
    expect(applyTransform(3.14159, { type: 'round', decimals: 3 })).toBe(3.142)
  })

  it('rgb_to_hex sur [R,G,B]', () => {
    expect(applyTransform([255, 100, 0], { type: 'rgb_to_hex' })).toBe('#ff6400')
  })

  it('rgb_to_hex sur [[R,G,B]] (forme WLED)', () => {
    expect(applyTransform([[255, 100, 0]], { type: 'rgb_to_hex' })).toBe('#ff6400')
  })

  it('rgb_to_hex jette sur valeur invalide', () => {
    expect(() => applyTransform('abc', { type: 'rgb_to_hex' })).toThrow()
  })

  it('array_first', () => {
    expect(applyTransform(['a', 'b'], { type: 'array_first' })).toBe('a')
    expect(applyTransform([], { type: 'array_first' })).toBeNull()
    expect(applyTransform('not array', { type: 'array_first' })).toBeNull()
  })

  it('array_contains', () => {
    expect(applyTransform(['x', 'y'], { type: 'array_contains', value: 'x' })).toBe(true)
    expect(applyTransform(['x', 'y'], { type: 'array_contains', value: 'z' })).toBe(false)
  })
})

describe('evalUnit', () => {
  const makeUnit = (overrides: Partial<Unit> = {}): Unit => ({
    id: 1, device_id: 1, position: 0, name: 'u',
    topic_pattern: 'x', json_path: null, condition: null,
    transform: { type: 'passthrough' },
    output_field: 'value', output_type: 'string', display: null,
    ...overrides,
  })

  it('extrait + transforme', () => {
    const u = makeUnit({ json_path: 'a.b', transform: { type: 'enum_map', map: { ON: true } } })
    const res = evalUnit(u, { a: { b: 'ON' } })
    expect(res.emitted).toBe(true)
    expect(res.value).toBe(true)
    expect(res.output_field).toBe('value')
  })

  it('condition false → pas d\'émission', () => {
    const u = makeUnit({
      json_path: 'a',
      condition: { path: 'flag', op: 'eq', value: true },
    })
    expect(evalUnit(u, { a: 1, flag: false }).emitted).toBe(false)
  })

  it('chemin extraction inexistant → pas d\'émission', () => {
    const u = makeUnit({ json_path: 'missing' })
    expect(evalUnit(u, { a: 1 }).emitted).toBe(false)
  })

  it('transform throw → pas d\'émission, error remontée', () => {
    const u = makeUnit({ json_path: 'a', transform: { type: 'scale', in_min: 0, in_max: 1, out_min: 0, out_max: 1 } })
    const res = evalUnit(u, { a: 'not-a-number' })
    expect(res.emitted).toBe(false)
    expect(res.error).toBeDefined()
  })

  it('payload entier si json_path null', () => {
    const u = makeUnit({ json_path: null })
    expect(evalUnit(u, 42).value).toBe(42)
    expect(evalUnit(u, 42).emitted).toBe(true)
  })
})
