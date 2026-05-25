import Redis from 'ioredis'
import type { DeviceState } from '../interpreters/types'

const DEVICE_KEY_PREFIX = 'device:'

export interface RedisStore {
  setDeviceState(source: string, state: DeviceState): Promise<void>
  getDeviceState(source: string): Promise<DeviceState | null>
  getAllDeviceStates(): Promise<Record<string, DeviceState>>
  quit(): Promise<void>
}

export function createRedisStore(url: string): RedisStore {
  const client = new Redis(url, { lazyConnect: false })

  return {
    async setDeviceState(source, state) {
      await client.set(`${DEVICE_KEY_PREFIX}${source}`, JSON.stringify(state))
    },

    async getDeviceState(source) {
      const raw = await client.get(`${DEVICE_KEY_PREFIX}${source}`)
      if (!raw) return null
      return JSON.parse(raw) as DeviceState
    },

    async getAllDeviceStates() {
      const keys = await client.keys(`${DEVICE_KEY_PREFIX}*`)
      if (keys.length === 0) return {}

      const values = await client.mget(...keys)
      const result: Record<string, DeviceState> = {}

      keys.forEach((key, i) => {
        const val = values[i]
        if (val) {
          const source = key.replace(DEVICE_KEY_PREFIX, '')
          result[source] = JSON.parse(val) as DeviceState
        }
      })

      return result
    },

    async quit() {
      await client.quit()
    },
  }
}
