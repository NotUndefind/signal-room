const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

export interface Unit {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition: object | null
  transform: object
  output_field: string
  output_type: 'boolean' | 'number' | 'string' | 'color' | 'enum'
  display: {
    label?: string
    icon?: string
    unit?: string
    min?: number
    max?: number
    on_label?: string
    off_label?: string
  } | null
}

export type UnitInput = Omit<Unit, 'id' | 'device_id'>

export interface RegistryDevice {
  id: number
  name: string
  debounce_ms: number | null
  layout: {
    groups?: { title?: string; fields: string[] }[]
    hidden?: string[]
  } | null
  units: Unit[]
  active: boolean
  created_at: number
}

export interface DevicePayload {
  name: string
  debounce_ms?: number | null
  layout?: object | null
  units: UnitInput[]
}

export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  placeholders: string[]
  units: UnitInput[]
}

export interface TopicSeen {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export async function fetchRegistry(): Promise<RegistryDevice[]> {
  const res = await fetch(`${API_URL}/api/registry`)
  const data = await res.json() as { devices: RegistryDevice[] }
  return data.devices
}

export async function fetchTopicsSeen(sinceSeconds?: number): Promise<TopicSeen[]> {
  const url = sinceSeconds
    ? `${API_URL}/api/topics?since=${sinceSeconds}`
    : `${API_URL}/api/topics`
  const res = await fetch(url)
  const data = await res.json() as { topics: TopicSeen[] }
  return data.topics
}

export async function fetchPresets(): Promise<Preset[]> {
  const res = await fetch(`${API_URL}/api/presets`)
  const data = await res.json() as { presets: Preset[] }
  return data.presets
}

export async function addDevice(payload: DevicePayload): Promise<number> {
  const res = await fetch(`${API_URL}/api/registry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as { id: number }
  return data.id
}

export async function patchDevice(id: number, payload: DevicePayload): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function removeDevice(id: number): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, { method: 'DELETE' })
}

export function applyPresetClient(preset: Preset, vars: Record<string, string>): UnitInput[] {
  return preset.units.map(unit => ({
    ...unit,
    topic_pattern: unit.topic_pattern.replace(/{(\w+)}/g, (_, k) => vars[k] ?? `{${k}}`),
    json_path: unit.json_path?.replace(/{(\w+)}/g, (_, k) => vars[k] ?? `{${k}}`) ?? null,
  }))
}
