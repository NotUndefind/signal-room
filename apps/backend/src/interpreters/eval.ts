import type { Condition, Transform, Unit } from './types'

export function getByPath(obj: unknown, path: string | null): unknown {
  if (path === null) return obj
  if (obj === null || obj === undefined) return undefined

  const tokens: (string | number)[] = []
  let current = ''
  let inBrackets = false

  for (const c of path) {
    if (c === '.' && !inBrackets) {
      if (current) tokens.push(current)
      current = ''
    } else if (c === '[') {
      if (current) tokens.push(current)
      current = ''
      inBrackets = true
    } else if (c === ']') {
      tokens.push(Number(current))
      current = ''
      inBrackets = false
    } else {
      current += c
    }
  }
  if (current) tokens.push(current)

  let value: unknown = obj
  for (const t of tokens) {
    if (value === null || value === undefined) return undefined
    if (typeof value !== 'object') return undefined
    value = (value as Record<string | number, unknown>)[t]
  }
  return value
}

export function evalCondition(payload: unknown, condition: Condition | null): boolean {
  if (condition === null) return true
  const value = getByPath(payload, condition.path)
  if (value === undefined) return false

  switch (condition.op) {
    case 'eq':
      return value === condition.value
    case 'neq':
      return value !== condition.value
    case 'in':
      return Array.isArray(condition.value) && (condition.value as unknown[]).includes(value)
    case 'contains':
      if (Array.isArray(value)) return value.includes(condition.value as never)
      if (typeof value === 'string') return value.includes(String(condition.value))
      return false
    case 'gt':
      return typeof value === 'number' && value > Number(condition.value)
    case 'gte':
      return typeof value === 'number' && value >= Number(condition.value)
    case 'lt':
      return typeof value === 'number' && value < Number(condition.value)
    case 'lte':
      return typeof value === 'number' && value <= Number(condition.value)
  }
}

export function applyTransform(value: unknown, t: Transform): unknown {
  switch (t.type) {
    case 'passthrough':
      return value
    case 'enum_map': {
      const key = String(value)
      if (key in t.map) return t.map[key]
      return t.default
    }
    case 'scale': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('scale: not a number')
      const ratio = (n - t.in_min) / (t.in_max - t.in_min)
      const out = t.out_min + ratio * (t.out_max - t.out_min)
      return t.round ? Math.round(out) : out
    }
    case 'round': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('round: not a number')
      const m = Math.pow(10, t.decimals)
      return Math.round(n * m) / m
    }
    case 'rgb_to_hex': {
      let rgb: number[]
      if (Array.isArray(value) && value.length >= 3 && value.every(v => typeof v === 'number')) {
        rgb = value as number[]
      } else if (Array.isArray(value) && Array.isArray(value[0])) {
        rgb = value[0] as number[]
      } else {
        throw new Error('rgb_to_hex: invalid RGB input')
      }
      const hex = rgb.slice(0, 3)
        .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')
      return '#' + hex
    }
    case 'array_first':
      return Array.isArray(value) && value.length > 0 ? value[0] : null
    case 'array_contains':
      return Array.isArray(value) && value.includes(t.value as never)
  }
}

export interface EvalResult {
  emitted: boolean
  output_field?: string
  value?: unknown
  error?: string
}

export function evalUnit(unit: Unit, payload: unknown): EvalResult {
  if (!evalCondition(payload, unit.condition)) {
    return { emitted: false }
  }
  const extracted = getByPath(payload, unit.json_path)
  if (extracted === undefined && unit.json_path !== null) {
    return { emitted: false }
  }
  try {
    const transformed = applyTransform(extracted, unit.transform)
    return { emitted: true, output_field: unit.output_field, value: transformed }
  } catch (e) {
    return { emitted: false, error: e instanceof Error ? e.message : 'unknown error' }
  }
}
