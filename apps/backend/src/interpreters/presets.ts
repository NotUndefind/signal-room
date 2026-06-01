import type { UnitInput, LayoutDescriptor } from './types'

export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  layout: LayoutDescriptor | null
  placeholders: string[]
  units: UnitInput[]
}

export const PRESETS: Preset[] = [
  {
    key: 'frigate-camera',
    name: 'Caméra Frigate',
    description: "Détection d'objets avec zones, événements start/end.",
    debounce_ms: 300,
    layout: null,
    placeholders: ['camera'],
    units: [
      { position: 0, name: 'Objet détecté', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.label', condition: null, transform: { type: 'passthrough' },
        output_field: 'object', output_type: 'string', display: { label: 'Objet', icon: 'User' } },
      { position: 1, name: 'Zone', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.current_zones', condition: null, transform: { type: 'array_first' },
        output_field: 'zone', output_type: 'string', display: { label: 'Zone', icon: 'Camera' } },
      { position: 2, name: 'Confiance', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.score', condition: null, transform: { type: 'round', decimals: 2 },
        output_field: 'confidence', output_type: 'number', display: { label: 'Confiance' } },
      { position: 3, name: 'Caméra', topic_pattern: 'frigate/{camera}/events',
        json_path: 'after.camera', condition: null, transform: { type: 'passthrough' },
        output_field: 'camera', output_type: 'string', display: { label: 'Caméra' } },
      { position: 4, name: 'État détection', topic_pattern: 'frigate/{camera}/events',
        json_path: 'type', condition: null,
        transform: { type: 'enum_map', map: { new: true, end: false }, default: false },
        output_field: 'active', output_type: 'boolean',
        display: { label: 'Active', on_label: 'En cours', off_label: 'Terminée' } },
      { position: 5, name: "Type d'événement", topic_pattern: 'frigate/{camera}/events',
        json_path: 'type', condition: null,
        transform: { type: 'enum_map', map: { new: 'detection_start', end: 'detection_end' } },
        output_field: 'event_type', output_type: 'string', display: null },
    ],
  },
  {
    key: 'wled',
    name: 'WLED',
    description: 'Ruban LED contrôlable : on/off, brightness, couleur, effet.',
    debounce_ms: null,
    layout: null,
    placeholders: ['device_id'],
    units: [
      { position: 0, name: 'Alimentation', topic_pattern: 'wled/{device_id}/v',
        json_path: 'on', condition: null, transform: { type: 'passthrough' },
        output_field: 'power', output_type: 'boolean',
        display: { label: 'Allumé', icon: 'Lightbulb', on_label: 'Allumé', off_label: 'Éteint' } },
      { position: 1, name: 'Luminosité', topic_pattern: 'wled/{device_id}/v',
        json_path: 'bri', condition: null,
        transform: { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true },
        output_field: 'brightness', output_type: 'number',
        display: { label: 'Luminosité', icon: 'Sun', unit: '%', min: 0, max: 100 } },
      { position: 2, name: 'Couleur', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].col[0]', condition: null, transform: { type: 'rgb_to_hex' },
        output_field: 'color', output_type: 'color', display: { label: 'Couleur' } },
      { position: 3, name: 'Effet', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].fx', condition: null, transform: { type: 'passthrough' },
        output_field: 'effect_id', output_type: 'number', display: { label: 'Effet' } },
      { position: 4, name: 'Palette', topic_pattern: 'wled/{device_id}/v',
        json_path: 'seg[0].pal', condition: null, transform: { type: 'passthrough' },
        output_field: 'palette_id', output_type: 'number', display: { label: 'Palette' } },
    ],
  },
  {
    key: 'tasmota-power',
    name: 'Tasmota POWER (relais)',
    description: 'Relais Tasmota : POWER / POWER1 / POWER2.',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id'],
    units: [
      { position: 0, name: 'Power', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: 'POWER', condition: null,
        transform: { type: 'enum_map', map: { ON: true, OFF: false } },
        output_field: 'power', output_type: 'boolean',
        display: { label: 'Allumé', icon: 'Plug', on_label: 'Allumé', off_label: 'Éteint' } },
      { position: 1, name: 'Identifiant', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: null, condition: null,
        transform: { type: 'enum_map', map: {}, default: '{device_id}' },
        output_field: 'device_id', output_type: 'string', display: null },
      { position: 2, name: 'RSSI', topic_pattern: '{prefix}tele/{device_id}/STATE',
        json_path: 'Wifi.RSSI', condition: null, transform: { type: 'passthrough' },
        output_field: 'rssi', output_type: 'number', display: { label: 'Signal', unit: 'dBm' } },
    ],
  },
  {
    key: 'tasmota-energy',
    name: 'Tasmota Énergie',
    description: 'Capteur Sonoff POW R2 ou équivalent (watt, kWh, voltage).',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id'],
    units: [
      { position: 0, name: 'Watt', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Power', condition: null, transform: { type: 'passthrough' },
        output_field: 'watt', output_type: 'number',
        display: { label: 'Puissance', icon: 'Zap', unit: 'W' } },
      { position: 1, name: 'Voltage', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Voltage', condition: null, transform: { type: 'passthrough' },
        output_field: 'voltage', output_type: 'number', display: { label: 'Tension', unit: 'V' } },
      { position: 2, name: 'Courant', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Current', condition: null, transform: { type: 'passthrough' },
        output_field: 'current', output_type: 'number', display: { label: 'Courant', unit: 'A' } },
      { position: 3, name: 'kWh aujourd\'hui', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Today', condition: null, transform: { type: 'passthrough' },
        output_field: 'kwh_today', output_type: 'number', display: { label: 'Aujourd\'hui', unit: 'kWh' } },
      { position: 4, name: 'kWh total', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: 'ENERGY.Total', condition: null, transform: { type: 'passthrough' },
        output_field: 'kwh_total', output_type: 'number', display: { label: 'Total', unit: 'kWh' } },
    ],
  },
  {
    key: 'tasmota-dht',
    name: 'Tasmota Température/Humidité',
    description: 'Capteurs ambiants (DHT22, AM2301, etc.) via topic SENSOR Tasmota.',
    debounce_ms: null,
    layout: null,
    placeholders: ['prefix', 'device_id', 'sensor'],
    units: [
      { position: 0, name: 'Température', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: '{sensor}.Temperature', condition: null, transform: { type: 'passthrough' },
        output_field: 'temperature', output_type: 'number',
        display: { label: 'Température', icon: 'Thermometer', unit: '°C' } },
      { position: 1, name: 'Humidité', topic_pattern: '{prefix}tele/{device_id}/SENSOR',
        json_path: '{sensor}.Humidity', condition: null, transform: { type: 'passthrough' },
        output_field: 'humidity', output_type: 'number', display: { label: 'Humidité', unit: '%' } },
    ],
  },
  {
    key: 'raw-passthrough',
    name: 'Passthrough brut',
    description: 'Affiche le payload brut sans interprétation (debug / inconnu).',
    debounce_ms: null,
    layout: null,
    placeholders: ['topic'],
    units: [
      { position: 0, name: 'Payload', topic_pattern: '{topic}',
        json_path: null, condition: null, transform: { type: 'passthrough' },
        output_field: 'payload', output_type: 'string', display: { label: 'Payload brut' } },
    ],
  },
]

export function findPreset(key: string): Preset | undefined {
  return PRESETS.find(p => p.key === key)
}

function substituteString(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? `{${name}}`)
}

export function applyPreset(preset: Preset, vars: Record<string, string>): UnitInput[] {
  return preset.units.map(u => ({
    ...u,
    topic_pattern: substituteString(u.topic_pattern, vars),
    json_path: u.json_path ? substituteString(u.json_path, vars) : null,
    transform: substituteTransform(u.transform, vars),
  }))
}

function substituteTransform(t: UnitInput['transform'], vars: Record<string, string>): UnitInput['transform'] {
  if (t.type === 'enum_map') {
    return {
      ...t,
      default: typeof t.default === 'string' ? substituteString(t.default, vars) : t.default,
    }
  }
  return t
}

export function extractVars(pattern: string, topic: string): Record<string, string> | null {
  const names: string[] = []
  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '{') {
      const end = pattern.indexOf('}', i)
      if (end === -1) { regexStr += '\\{'; i++; continue }
      const name = pattern.slice(i + 1, end)
      names.push(name)
      regexStr += name === 'prefix' ? '(.*?)' : '([^/]+)'
      i = end + 1
    } else {
      const c = pattern[i]
      regexStr += /[.+?^$()|[\]\\]/.test(c) ? '\\' + c : c
      i++
    }
  }
  const m = new RegExp(`^${regexStr}$`).exec(topic)
  if (!m) return null
  const out: Record<string, string> = {}
  names.forEach((n, idx) => { out[n] = m[idx + 1] })
  return out
}
