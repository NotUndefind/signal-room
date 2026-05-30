import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import { config } from './config'
import { createDb } from './db/client'
import { applySchema } from './db/schema'
import { createRetentionJob } from './db/retention'
import { createRedisStore } from './store/redis'
import { createDedupStore } from './pipeline/dedup'
import { createDebounce } from './pipeline/debounce'
import { createDynamicRegistry } from './interpreters/dynamic'
import { seedDeviceRegistry } from './db/registry'
import { upsertTopicSeen } from './db/topics'
import { registerTopicsRoutes } from './api/topics-routes'
import { registerRegistryRoutes } from './api/registry-routes'
import type { DeviceState } from './interpreters/types'
import { createMqttClient } from './mqtt/client'
import { createBroadcaster, registerWsRoutes } from './ws/server'
import { registerDeviceRoutes } from './api/devices'
import { registerHistoryRoutes } from './api/history'
import { insertEvent, insertSnapshot } from './db/queries'

async function main() {
  const db = createDb(config.db.path)
  applySchema(db)

  seedDeviceRegistry(db, config.tasmota.topicPrefix)
  const deviceRegistry = createDynamicRegistry(db, config)

  const redisStore = createRedisStore(config.redis.url)
  const dedupStore = createDedupStore()
  const broadcaster = createBroadcaster()

  const fastify = Fastify({ logger: true })
  await fastify.register(cors, { origin: true })
  await fastify.register(websocket)

  registerWsRoutes(fastify, broadcaster, redisStore)
  registerDeviceRoutes(fastify, redisStore)
  registerHistoryRoutes(fastify, db)
  registerTopicsRoutes(fastify, db)
  registerRegistryRoutes(fastify, db, deviceRegistry)

  const retentionJob = createRetentionJob(db, config.retention.days)
  retentionJob.start()

  function deviceKey(state: DeviceState): string {
    const sub = String(state.state.camera ?? state.state.device_id ?? state.state.topic ?? '')
    return sub ? `${state.source}:${sub}` : state.source
  }

  const debounceMap = new Map<string, ReturnType<typeof createDebounce>>()

  function getDebounce(source: string): ReturnType<typeof createDebounce> | null {
    const ms = deviceRegistry.getDebounceMs(source)
    if (!ms) return null
    if (!debounceMap.has(source)) {
      debounceMap.set(source, createDebounce(ms))
    }
    return debounceMap.get(source)!
  }

  function processState(topic: string, payload: Buffer) {
    const state = deviceRegistry.route(topic, payload)

    setImmediate(() => {
      try {
        upsertTopicSeen(db, topic, state?.source ?? null)
      } catch (e) {
        console.error('[Catalogue] Upsert error:', e)
      }
    })

    if (!state) return

    const debounce = getDebounce(state.source)

    const handle = () => {
      const key = deviceKey(state)
      if (!dedupStore.hasChanged(key, state)) {
        console.log(`[Pipeline] Dedup — état inchangé pour: ${key}`)
        return
      }
      dedupStore.update(key, state)
      console.log(`[Pipeline] Broadcast — source: ${key} | event: ${state.event_type}`)
      broadcaster.broadcast(key, state)

      redisStore.setDeviceState(key, state).catch(console.error)

      setImmediate(() => {
        insertEvent(db, {
          source: state.source,
          topic,
          event_type: state.event_type,
          payload: JSON.stringify(state.state),
          raw: state.raw,
          created_at: state.timestamp,
        })
        insertSnapshot(db, state.source, JSON.stringify(state.state))
      })
    }

    if (debounce) {
      debounce(state.source, handle)
    } else {
      handle()
    }
  }

  createMqttClient({
    host: config.mqtt.host,
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
    topics: ['#'],
    onMessage: processState,
  })

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[Server] Backend running on port ${config.port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
