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
import { getAllDevices } from './db/registry'
import { createUnitRegistry } from './interpreters/registry'
import { createAggregator } from './interpreters/aggregator'
import { upsertTopicSeen } from './db/topics'
import { registerTopicsRoutes } from './api/topics-routes'
import { registerRegistryRoutes } from './api/registry-routes'
import { registerPresetsRoutes } from './api/presets-routes'
import { createMqttClient } from './mqtt/client'
import { createBroadcaster, registerWsRoutes } from './ws/server'
import { registerDeviceRoutes } from './api/devices'
import { registerHistoryRoutes } from './api/history'
import { insertEvent, insertSnapshot } from './db/queries'

async function main() {
  const db = createDb(config.db.path)
  applySchema(db)

  const devices = getAllDevices(db)
  const unitRegistry = createUnitRegistry(devices)
  const aggregator = createAggregator()

  const redisStore = createRedisStore(config.redis.url)
  const dedupStore = createDedupStore()
  const broadcaster = createBroadcaster()

  const fastify = Fastify({ logger: true })
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
  await fastify.register(websocket)

  registerWsRoutes(fastify, broadcaster, redisStore)
  registerDeviceRoutes(fastify, redisStore)
  registerHistoryRoutes(fastify, db)
  registerTopicsRoutes(fastify, db)
  registerRegistryRoutes(fastify, db, unitRegistry)
  registerPresetsRoutes(fastify)

  const retentionJob = createRetentionJob(db, config.retention.days)
  retentionJob.start()

  const debounceMap = new Map<number, ReturnType<typeof createDebounce>>()
  function getDebounce(deviceId: number): ReturnType<typeof createDebounce> | null {
    const ms = unitRegistry.getDebounceMs(deviceId)
    if (!ms) return null
    if (!debounceMap.has(deviceId)) debounceMap.set(deviceId, createDebounce(ms))
    return debounceMap.get(deviceId)!
  }

  function processMessage(topic: string, payload: Buffer) {
    const results = unitRegistry.route(topic, payload)

    setImmediate(() => {
      try {
        const firstSource = results[0] ? results[0].device_id.toString() : null
        upsertTopicSeen(db, topic, firstSource)
      } catch (e) {
        console.error('[Catalogue] Upsert error:', e)
      }
    })

    for (const result of results) {
      const state = aggregator.merge(result.device_id, result.partial_state, result.raw)
      const key = state.source
      const debounce = getDebounce(result.device_id)

      const handle = () => {
        if (!dedupStore.hasChanged(key, state)) {
          console.log(`[Pipeline] Dedup — état inchangé pour: ${key}`)
          return
        }
        dedupStore.update(key, state)
        console.log(`[Pipeline] Broadcast — ${key} | event: ${state.event_type}`)
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

      if (debounce) debounce(String(result.device_id), handle)
      else handle()
    }
  }

  createMqttClient({
    host: config.mqtt.host,
    port: config.mqtt.port,
    topics: ['#'],
    onMessage: processMessage,
  })

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[Server] Backend running on port ${config.port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
