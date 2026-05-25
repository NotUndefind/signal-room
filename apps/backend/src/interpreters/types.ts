export interface DeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  raw: string
  timestamp: number
}

export interface Interpreter {
  source: string
  topics: string[]
  debounceMs?: number
  parse(topic: string, payload: Buffer): DeviceState | null
}
