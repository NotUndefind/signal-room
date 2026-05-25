import type { Interpreter, DeviceState } from './types'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { tasmotaInterpreter } from './tasmota'

export const DEFAULT_INTERPRETERS: Interpreter[] = [
  frigateInterpreter,
  wledInterpreter,
  tasmotaInterpreter,
]

export interface InterpreterRegistry {
  getAllTopics(): string[]
  route(topic: string, payload: Buffer): DeviceState | null
  getDebounceMs(source: string): number | undefined
}

export function createInterpreterRegistry(interpreters: Interpreter[]): InterpreterRegistry {
  return {
    getAllTopics() {
      return interpreters.flatMap(i => i.topics)
    },

    route(topic: string, payload: Buffer): DeviceState | null {
      for (const interpreter of interpreters) {
        const result = interpreter.parse(topic, payload)
        if (result !== null) return result
      }
      return null
    },

    getDebounceMs(source: string): number | undefined {
      return interpreters.find(i => i.source === source)?.debounceMs
    },
  }
}
