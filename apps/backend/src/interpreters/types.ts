export interface DeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  raw: string
  timestamp: number
}

export type OutputType = 'boolean' | 'number' | 'string' | 'color' | 'enum'

export type ConditionOp = 'eq' | 'neq' | 'in' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'

export interface Condition {
  path: string
  op: ConditionOp
  value: string | number | boolean | (string | number)[]
}

export type Transform =
  | { type: 'passthrough' }
  | { type: 'enum_map'; map: Record<string, unknown>; default?: unknown }
  | { type: 'scale'; in_min: number; in_max: number; out_min: number; out_max: number; round?: boolean }
  | { type: 'round'; decimals: number }
  | { type: 'rgb_to_hex' }
  | { type: 'array_first' }
  | { type: 'array_contains'; value: string | number }

export interface Display {
  label?: string
  icon?: string
  unit?: string
  min?: number
  max?: number
  on_label?: string
  off_label?: string
}

export interface LayoutDescriptor {
  groups?: { title?: string; fields: string[] }[]
  hidden?: string[]
}

export interface Unit {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition: Condition | null
  transform: Transform
  output_field: string
  output_type: OutputType
  display: Display | null
}

export type UnitInput = Omit<Unit, 'id' | 'device_id'>

export interface DeviceEntry {
  id: number
  name: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  units: Unit[]
  active: boolean
  created_at: number
}

export interface DevicePayload {
  name: string
  debounce_ms?: number | null
  layout?: LayoutDescriptor | null
  units: UnitInput[]
}

export interface RouteResult {
  device_id: number
  partial_state: Record<string, unknown>
  raw: string
}
