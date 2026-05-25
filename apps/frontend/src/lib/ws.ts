import type { FrontendDeviceState } from '@/store/room'

interface WsClientOptions {
  url: string
  onSnapshot: (devices: Record<string, FrontendDeviceState>) => void
  onUpdate: (source: string, state: FrontendDeviceState) => void
  onConnectionChange: (connected: boolean) => void
}

interface WsClient {
  disconnect(): void
  getSocket(): WebSocket
}

export function createWsClient(options: WsClientOptions): WsClient {
  let ws: WebSocket
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 1000

  function connect() {
    ws = new WebSocket(options.url)

    ws.onopen = () => {
      reconnectDelay = 1000
      options.onConnectionChange(true)
    }

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'snapshot') {
          options.onSnapshot(msg.data as Record<string, FrontendDeviceState>)
        } else if (msg.type === 'update') {
          options.onUpdate(msg.source as string, msg.state as FrontendDeviceState)
        }
      } catch {
        console.error('[WS] Failed to parse message')
      }
    }

    ws.onclose = () => {
      options.onConnectionChange(false)
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
        connect()
      }, reconnectDelay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  connect()

  return {
    disconnect() {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws.close()
    },
    getSocket() {
      return ws
    },
  }
}
