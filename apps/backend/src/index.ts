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
import { createInterpreterRegistry, DEFAULT_INTERPRETERS } from './interpreters/index'
import { createMqttClient } from './mqtt/client'
import { createBroadcaster, registerWsRoutes } from './ws/server'
import { registerDeviceRoutes } from './api/devices'
import { registerHistoryRoutes } from './api/history'
import { insertEvent, insertSnapshot } from './db/queries'

async function main() {
  const db = createDb(config.db.path)
  applySchema(db)

  const redisStore = createRedisStore(config.redis.url)
  const dedupStore = createDedupStore()
  const registry = createInterpreterRegistry(DEFAULT_INTERPRETERS)
  const broadcaster = createBroadcaster()

  const fastify = Fastify({ logger: true })
  await fastify.register(cors, { origin: true })
  await fastify.register(websocket)

  registerWsRoutes(fastify, broadcaster, redisStore)
  registerDeviceRoutes(fastify, redisStore)
  registerHistoryRoutes(fastify, db)

  const retentionJob = createRetentionJob(db, config.retention.days)
  retentionJob.start()

  const debounceMap = new Map<string, ReturnType<typeof createDebounce>>()

  function getDebounce(source: string): ReturnType<typeof createDebounce> | null {
    const ms = registry.getDebounceMs(source)
    if (!ms) return null
    if (!debounceMap.has(source)) {
      debounceMap.set(source, createDebounce(ms))
    }
    return debounceMap.get(source)!
  }

  function processState(topic: string, payload: Buffer) {
    const state = registry.route(topic, payload)
    if (!state) return

    const debounce = getDebounce(state.source)

    const handle = () => {
      if (!dedupStore.hasChanged(state)) return
      dedupStore.update(state)

      broadcaster.broadcast(state.source, state)

      redisStore.setDeviceState(state.source, state).catch(console.error)

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
    topics: registry.getAllTopics(),
    onMessage: processState,
  })

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[Server] Backend running on port ${config.port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
