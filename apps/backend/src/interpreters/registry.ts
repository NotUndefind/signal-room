import type { DeviceEntry, RouteResult } from './types'
import { evalUnit } from './eval'
import { mqttTopicMatches } from '../mqtt/matcher'

export interface UnitRegistry {
  getAllTopics(): string[]
  route(topic: string, payload: Buffer): RouteResult[]
  getDebounceMs(deviceId: number): number | null
  addDevice(entry: DeviceEntry): void
  removeDevice(id: number): void
  replaceDevice(entry: DeviceEntry): void
  getDevice(id: number): DeviceEntry | undefined
}

export function createUnitRegistry(initial: DeviceEntry[]): UnitRegistry {
  let devices: DeviceEntry[] = [...initial]

  function parsePayload(buf: Buffer): unknown {
    const str = buf.toString()
    try {
      return JSON.parse(str)
    } catch {
      return str
    }
  }

  return {
    getAllTopics() {
      const set = new Set<string>()
      for (const d of devices) {
        if (!d.active) continue
        for (const u of d.units) set.add(u.topic_pattern)
      }
      return Array.from(set)
    },

    route(topic, payload) {
      const parsed = parsePayload(payload)
      const raw = payload.toString()
      const results: RouteResult[] = []

      for (const d of devices) {
        if (!d.active) continue
        const partial: Record<string, unknown> = {}
        let touched = false
        for (const u of d.units) {
          if (!mqttTopicMatches(u.topic_pattern, topic)) continue
          const res = evalUnit(u, parsed)
          if (res.emitted && res.output_field) {
            partial[res.output_field] = res.value
            touched = true
          }
        }
        if (touched) results.push({ device_id: d.id, partial_state: partial, raw })
      }
      return results
    },

    getDebounceMs(deviceId) {
      const d = devices.find(x => x.id === deviceId)
      return d?.debounce_ms ?? null
    },

    addDevice(entry) {
      devices = [...devices, entry]
    },

    removeDevice(id) {
      devices = devices.filter(d => d.id !== id)
    },

    replaceDevice(entry) {
      devices = devices.map(d => d.id === entry.id ? entry : d)
    },

    getDevice(id) {
      return devices.find(d => d.id === id)
    },
  }
}
