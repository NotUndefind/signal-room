import type { DeviceState } from './types'

export interface DeviceAggregator {
  merge(deviceId: number, partial: Record<string, unknown>, raw: string): DeviceState
  hydrate(deviceId: number, state: Record<string, unknown>): void
  reset(deviceId: number): void
  getState(deviceId: number): Record<string, unknown> | undefined
}

export function createAggregator(): DeviceAggregator {
  const map = new Map<number, Record<string, unknown>>()

  return {
    merge(deviceId, partial, raw) {
      const existing = map.get(deviceId) ?? {}
      const merged = { ...existing, ...partial }
      map.set(deviceId, merged)

      const { event_type, ...publicState } = merged

      return {
        source: `device:${deviceId}`,
        event_type: typeof event_type === 'string' ? event_type : 'state_change',
        state: publicState,
        raw,
        timestamp: Date.now(),
      }
    },

    hydrate(deviceId, state) {
      map.set(deviceId, { ...state })
    },

    reset(deviceId) {
      map.delete(deviceId)
    },

    getState(deviceId) {
      return map.get(deviceId)
    },
  }
}
