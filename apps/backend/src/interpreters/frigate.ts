import type { Interpreter, DeviceState } from './types'

interface FrigateEventAfter {
  id: string
  label: string
  camera: string
  current_zones: string[]
  score: number
}

interface FrigatePayload {
  type: 'new' | 'update' | 'end'
  after: FrigateEventAfter
}

export const frigateInterpreter: Interpreter = {
  source: 'frigate',
  topics: ['frigate/+/events'],
  debounceMs: 300,

  parse(topic: string, payload: Buffer): DeviceState | null {
    if (!topic.endsWith('/events')) return null

    let data: FrigatePayload
    try {
      data = JSON.parse(payload.toString()) as FrigatePayload
    } catch {
      return null
    }

    if (data.type === 'update') return null

    const { after } = data
    const event_type = data.type === 'new' ? 'detection_start' : 'detection_end'

    return {
      source: 'frigate',
      event_type,
      state: {
        object: after.label,
        zone: after.current_zones[0] ?? 'unknown',
        confidence: Math.round(after.score * 100) / 100,
        camera: after.camera,
        session_id: after.id,
        active: data.type === 'new',
      },
      raw: payload.toString(),
      timestamp: Date.now(),
    }
  },
}
