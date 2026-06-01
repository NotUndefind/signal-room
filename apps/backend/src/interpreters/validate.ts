import type { UnitInput, DevicePayload, Condition, Transform, OutputType, LayoutDescriptor } from './types'

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const TOPIC_SEG = /^[a-zA-Z0-9_-]+$/
const JSON_PATH = /^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*|\[\d+\])*$/
const FIELD_NAME = /^[a-zA-Z_]\w*$/
const OUTPUT_TYPES: OutputType[] = ['boolean', 'number', 'string', 'color', 'enum']
const CONDITION_OPS = ['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte'] as const

function validateTopicPattern(p: unknown): Result<string> {
  if (typeof p !== 'string' || p.length === 0) return { ok: false, error: 'topic_pattern: string non vide requis' }
  if (p.length > 256) return { ok: false, error: 'topic_pattern: longueur max 256' }
  const segments = p.split('/')
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '+') continue
    if (seg === '#') {
      if (i !== segments.length - 1) return { ok: false, error: 'topic_pattern: # uniquement en dernier segment' }
      continue
    }
    if (!TOPIC_SEG.test(seg)) return { ok: false, error: `topic_pattern: segment invalide "${seg}"` }
  }
  return { ok: true, value: p }
}

function validateJsonPath(p: unknown): Result<string | null> {
  if (p === null || p === undefined) return { ok: true, value: null }
  if (typeof p !== 'string') return { ok: false, error: 'json_path: string ou null requis' }
  if (!JSON_PATH.test(p)) return { ok: false, error: `json_path: format invalide "${p}"` }
  return { ok: true, value: p }
}

function validateCondition(c: unknown): Result<Condition | null> {
  if (c === null || c === undefined) return { ok: true, value: null }
  if (typeof c !== 'object') return { ok: false, error: 'condition: objet ou null requis' }
  const obj = c as Record<string, unknown>
  const pathRes = validateJsonPath(obj.path)
  if (!pathRes.ok) return { ok: false, error: `condition.${pathRes.error}` }
  if (pathRes.value === null) return { ok: false, error: 'condition.path requis' }
  if (typeof obj.op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(obj.op)) {
    return { ok: false, error: `condition.op: doit être ${CONDITION_OPS.join('|')}` }
  }
  if (obj.value === undefined) return { ok: false, error: 'condition.value requis' }
  return { ok: true, value: { path: pathRes.value, op: obj.op as Condition['op'], value: obj.value as Condition['value'] } }
}

function validateTransform(t: unknown): Result<Transform> {
  if (typeof t !== 'object' || t === null) return { ok: false, error: 'transform: objet requis' }
  const obj = t as Record<string, unknown>
  switch (obj.type) {
    case 'passthrough':
      return { ok: true, value: { type: 'passthrough' } }
    case 'enum_map':
      if (typeof obj.map !== 'object' || obj.map === null) return { ok: false, error: 'enum_map.map requis' }
      return { ok: true, value: { type: 'enum_map', map: obj.map as Record<string, unknown>, default: obj.default } }
    case 'scale':
      for (const k of ['in_min', 'in_max', 'out_min', 'out_max']) {
        if (typeof obj[k] !== 'number') return { ok: false, error: `scale.${k}: numérique requis` }
      }
      return {
        ok: true,
        value: {
          type: 'scale',
          in_min: obj.in_min as number,
          in_max: obj.in_max as number,
          out_min: obj.out_min as number,
          out_max: obj.out_max as number,
          round: Boolean(obj.round),
        },
      }
    case 'round':
      if (typeof obj.decimals !== 'number') return { ok: false, error: 'round.decimals: numérique requis' }
      return { ok: true, value: { type: 'round', decimals: obj.decimals } }
    case 'rgb_to_hex':
      return { ok: true, value: { type: 'rgb_to_hex' } }
    case 'array_first':
      return { ok: true, value: { type: 'array_first' } }
    case 'array_contains':
      if (obj.value === undefined) return { ok: false, error: 'array_contains.value requis' }
      return { ok: true, value: { type: 'array_contains', value: obj.value as string | number } }
    default:
      return { ok: false, error: `transform.type inconnu: ${String(obj.type)}` }
  }
}

export function validateUnitInput(input: unknown): Result<UnitInput> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'unit: objet requis' }
  const obj = input as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) return { ok: false, error: 'unit.name requis' }
  if (typeof obj.position !== 'number') return { ok: false, error: 'unit.position numérique requis' }

  const topicRes = validateTopicPattern(obj.topic_pattern)
  if (!topicRes.ok) return { ok: false, error: topicRes.error }

  const pathRes = validateJsonPath(obj.json_path)
  if (!pathRes.ok) return { ok: false, error: pathRes.error }

  const condRes = validateCondition(obj.condition ?? null)
  if (!condRes.ok) return { ok: false, error: condRes.error }

  const transRes = validateTransform(obj.transform)
  if (!transRes.ok) return { ok: false, error: transRes.error }

  if (typeof obj.output_field !== 'string' || !FIELD_NAME.test(obj.output_field) || obj.output_field.length > 64) {
    return { ok: false, error: 'output_field: identifiant valide requis' }
  }
  if (typeof obj.output_type !== 'string' || !(OUTPUT_TYPES as string[]).includes(obj.output_type)) {
    return { ok: false, error: `output_type: ${OUTPUT_TYPES.join('|')}` }
  }
  if (obj.output_field === 'event_type' && obj.output_type !== 'string' && obj.output_type !== 'enum') {
    return { ok: false, error: 'output_field=event_type doit avoir output_type=string|enum' }
  }

  const display = obj.display && typeof obj.display === 'object' ? (obj.display as UnitInput['display']) : null

  return {
    ok: true,
    value: {
      position: obj.position,
      name: obj.name,
      topic_pattern: topicRes.value,
      json_path: pathRes.value,
      condition: condRes.value,
      transform: transRes.value,
      output_field: obj.output_field,
      output_type: obj.output_type as OutputType,
      display,
    },
  }
}

export function validateLayout(input: unknown): Result<LayoutDescriptor | null> {
  if (input === null || input === undefined) return { ok: true, value: null }
  if (typeof input !== 'object') return { ok: false, error: 'layout: objet ou null requis' }
  return { ok: true, value: input as LayoutDescriptor }
}

export function validateDevicePayload(input: unknown): Result<DevicePayload> {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'device: objet requis' }
  const obj = input as Record<string, unknown>

  if (typeof obj.name !== 'string' || obj.name.length === 0) return { ok: false, error: 'device.name requis' }
  if (!Array.isArray(obj.units) || obj.units.length === 0) return { ok: false, error: 'device.units: tableau non vide requis' }
  if (obj.units.length > 30) return { ok: false, error: 'device.units: max 30 units par device' }

  const units: UnitInput[] = []
  const fieldTypes = new Map<string, string>()

  for (let i = 0; i < obj.units.length; i++) {
    const res = validateUnitInput(obj.units[i])
    if (!res.ok) return { ok: false, error: `units[${i}]: ${res.error}` }
    const prev = fieldTypes.get(res.value.output_field)
    if (prev && prev !== res.value.output_type) {
      return { ok: false, error: `units[${i}]: output_field "${res.value.output_field}" déclaré avec types différents` }
    }
    fieldTypes.set(res.value.output_field, res.value.output_type)
    units.push(res.value)
  }

  let debounceMs: number | null = null
  if (obj.debounce_ms !== undefined && obj.debounce_ms !== null) {
    if (typeof obj.debounce_ms !== 'number' || obj.debounce_ms < 0) {
      return { ok: false, error: 'debounce_ms: numérique positif ou null' }
    }
    debounceMs = obj.debounce_ms
  }

  const layoutRes = validateLayout(obj.layout ?? null)
  if (!layoutRes.ok) return { ok: false, error: layoutRes.error }

  return { ok: true, value: { name: obj.name, units, debounce_ms: debounceMs, layout: layoutRes.value } }
}
