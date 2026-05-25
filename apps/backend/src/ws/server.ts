import type { WebSocket } from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { DeviceState } from '../interpreters/types'
import type { RedisStore } from '../store/redis'

interface WsMessage {
  type: 'snapshot' | 'update'
  data?: Record<string, DeviceState>
  source?: string
  state?: DeviceState
}

export interface Broadcaster {
  addClient(ws: WebSocket): void
  removeClient(ws: WebSocket): void
  broadcast(source: string, state: DeviceState): void
}

export function createBroadcaster(): Broadcaster {
  const clients = new Set<WebSocket>()

  return {
    addClient(ws: WebSocket) {
      clients.add(ws)
    },

    removeClient(ws: WebSocket) {
      clients.delete(ws)
    },

    broadcast(source: string, state: DeviceState) {
      const message: WsMessage = { type: 'update', source, state }
      const payload = JSON.stringify(message)

      for (const client of clients) {
        if (client.readyState === 1) {
          client.send(payload)
        }
      }
    },
  }
}

export async function registerWsRoutes(
  fastify: FastifyInstance,
  broadcaster: Broadcaster,
  redisStore: RedisStore
): Promise<void> {
  fastify.get('/ws', { websocket: true }, async (socket) => {
    broadcaster.addClient(socket)

    const snapshot = await redisStore.getAllDeviceStates()
    const message: WsMessage = { type: 'snapshot', data: snapshot }
    socket.send(JSON.stringify(message))

    socket.on('close', () => {
      broadcaster.removeClient(socket)
    })
  })
}
