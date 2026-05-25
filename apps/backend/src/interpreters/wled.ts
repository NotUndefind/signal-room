import type { Interpreter, DeviceState } from './types'

interface WledSegment {
  col: number[][]
  fx: number
  pal: number
}

interface WledPayload {
  on: boolean
  bri: number
  seg?: WledSegment[]
}

function toHex(rgb: number[]): string {
  return '#' + rgb.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')
}

export const wledInterpreter: Interpreter = {
  source: 'wled',
  topics: ['wled/+/v'],

  parse(topic: string, payload: Buffer): DeviceState | null {
    if (!topic.endsWith('/v')) return null

    let data: WledPayload
    try {
      data = JSON.parse(payload.toString()) as WledPayload
    } catch {
      return null
    }

    const segment = data.seg?.[0]
    const color = segment?.col?.[0] ? toHex(segment.col[0]) : '#000000'
    const brightness = Math.round((data.bri / 255) * 100)

    return {
      source: 'wled',
      event_type: 'state_change',
      state: {
        power: data.on,
        brightness,
        color,
        effect_id: segment?.fx ?? 0,
        palette_id: segment?.pal ?? 0,
      },
      raw: payload.toString(),
      timestamp: Date.now(),
    }
  },
}
