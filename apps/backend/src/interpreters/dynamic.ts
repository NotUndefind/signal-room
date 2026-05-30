import type Database from 'better-sqlite3'
import type { DeviceState, Interpreter } from './types'
import type { Config } from '../config'
import type { DeviceEntry } from '../db/registry'
import { getAllDevices } from '../db/registry'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { createTasmotaInterpreter } from './tasmota'
import { rawInterpreter } from './raw'
import { mqttTopicMatches } from '../mqtt/matcher'

export interface DynamicRegistry {
  route(topic: string, payload: Buffer): DeviceState | null
  getDebounceMs(source: string): number | undefined
  addDevice(entry: DeviceEntry): void
  removeDevice(id: number): void
}

export function createDynamicRegistry(db: Database.Database, config: Config): DynamicRegistry {
  const interpreterMap: Record<string, Interpreter> = {
    frigate: frigateInterpreter,
    tasmota: createTasmotaInterpreter(config.tasmota.topicPrefix),
    wled: wledInterpreter,
    raw: rawInterpreter,
  }

  let devices: DeviceEntry[] = getAllDevices(db).filter(d => d.active === 1)

  return {
    route(topic: string, payload: Buffer): DeviceState | null {
      for (const device of devices) {
        const matches = device.topic_patterns.some(p => mqttTopicMatches(p, topic))
        if (!matches) continue
        const interpreter = interpreterMap[device.interpreter_type]
        if (!interpreter) continue
        const result = interpreter.parse(topic, payload)
        if (result !== null) return result
      }
      return null
    },

    getDebounceMs(source: string): number | undefined {
      return interpreterMap[source]?.debounceMs
    },

    addDevice(entry: DeviceEntry): void {
      devices = [...devices, entry]
    },

    removeDevice(id: number): void {
      devices = devices.filter(d => d.id !== id)
    },
  }
}
