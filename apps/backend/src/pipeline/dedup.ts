import type { DeviceState } from '../interpreters/types'

export interface DedupStore {
  hasChanged(key: string, state: DeviceState): boolean
  update(key: string, state: DeviceState): void
}

export function createDedupStore(): DedupStore {
  const memory = new Map<string, string>()

  return {
    hasChanged(key: string, state: DeviceState): boolean {
      const serialized = JSON.stringify(state.state)
      return memory.get(key) !== serialized
    },

    update(key: string, state: DeviceState): void {
      memory.set(key, JSON.stringify(state.state))
    },
  }
}
