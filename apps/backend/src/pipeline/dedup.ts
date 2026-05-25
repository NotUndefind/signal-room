import type { DeviceState } from '../interpreters/types'

export interface DedupStore {
  hasChanged(state: DeviceState): boolean
  update(state: DeviceState): void
}

export function createDedupStore(): DedupStore {
  const memory = new Map<string, string>()

  return {
    hasChanged(state: DeviceState): boolean {
      const key = state.source
      const serialized = JSON.stringify(state.state)
      return memory.get(key) !== serialized
    },

    update(state: DeviceState): void {
      memory.set(state.source, JSON.stringify(state.state))
    },
  }
}
