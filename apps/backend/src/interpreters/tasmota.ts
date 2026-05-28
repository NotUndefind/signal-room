import type { Interpreter, DeviceState } from './types'

interface TasmotaStatePayload {
  Time?: string
  POWER?: 'ON' | 'OFF'
  POWER1?: 'ON' | 'OFF'
  POWER2?: 'ON' | 'OFF'
  Wifi?: { RSSI?: number }
}

interface TasmotaEnergy {
  Power?: number
  Voltage?: number
  Current?: number
  Today?: number
  Total?: number
}

interface TasmotaSensorPayload {
  Time?: string
  ENERGY?: TasmotaEnergy
  [key: string]: unknown
}

export function createTasmotaInterpreter(topicPrefix = ''): Interpreter {
  const p = topicPrefix

  function stripPrefix(topic: string): string {
    return p ? topic.slice(p.length) : topic
  }

  return {
    source: 'tasmota',
    topics: [
      `${p}stat/+/RESULT`,
      `${p}tele/+/STATE`,
      `${p}tele/+/SENSOR`,
    ],

    parse(topic: string, payload: Buffer): DeviceState | null {
      const stripped = stripPrefix(topic)
      const parts = stripped.split('/')
      const msgType = parts[2]

      if (msgType !== 'STATE' && msgType !== 'SENSOR' && msgType !== 'RESULT') return null

      const device_id = parts[1] ?? 'unknown'
      let data: TasmotaStatePayload & TasmotaSensorPayload

      try {
        data = JSON.parse(payload.toString())
      } catch {
        return null
      }

      if (msgType === 'STATE' || msgType === 'RESULT') {
        const powerRaw = data.POWER2 ?? data.POWER1 ?? data.POWER
        if (powerRaw === undefined) return null

        return {
          source: 'tasmota',
          event_type: 'state_change',
          state: {
            device_id,
            power: powerRaw === 'ON',
            rssi: data.Wifi?.RSSI,
          },
          raw: payload.toString(),
          timestamp: Date.now(),
        }
      }

      if (msgType === 'SENSOR') {
        const state: Record<string, unknown> = { device_id }

        if (data.ENERGY) {
          state.watt = data.ENERGY.Power
          state.voltage = data.ENERGY.Voltage
          state.current = data.ENERGY.Current
          state.kwh_today = data.ENERGY.Today
          state.kwh_total = data.ENERGY.Total
          return {
            source: 'tasmota',
            event_type: 'sensor_update',
            state,
            raw: payload.toString(),
            timestamp: Date.now(),
          }
        }

        for (const [key, val] of Object.entries(data)) {
          if (key === 'Time') continue
          if (typeof val === 'object' && val !== null) {
            const sensor = val as Record<string, unknown>
            if ('Temperature' in sensor) state.temperature = sensor.Temperature
            if ('Humidity' in sensor) state.humidity = sensor.Humidity
            if ('Pressure' in sensor) state.pressure = sensor.Pressure
          }
        }

        if (Object.keys(state).length <= 1) return null

        return {
          source: 'tasmota',
          event_type: 'sensor_update',
          state,
          raw: payload.toString(),
          timestamp: Date.now(),
        }
      }

      return null
    },
  }
}

export const tasmotaInterpreter = createTasmotaInterpreter()
