'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { FrigateCard } from '@/components/devices/FrigateCard'
import { WledCard } from '@/components/devices/WledCard'
import { TasmotaCard } from '@/components/devices/TasmotaCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()

  useEffect(() => {
    const client = createWsClient({
      url: WS_URL,
      onSnapshot: setDevices,
      onUpdate: setDevice,
      onConnectionChange: setConnected,
    })
    return () => client.disconnect()
  }, [setDevice, setDevices, setConnected])

  const frigateSources = Object.values(devices).filter(d => d.source === 'frigate')
  const tasmotaSources = Object.values(devices).filter(d => d.source === 'tasmota')

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signal Room</h1>
          <p className="text-muted-foreground text-sm mt-1">Tableau de bord de la chambre connectée</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusIndicator connected={connected} />
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {frigateSources.length > 0 ? (
          frigateSources.map((d) => (
            <FrigateCard key={String(d.state.camera ?? d.source)} state={d} />
          ))
        ) : (
          <FrigateCard state={undefined} />
        )}
        <WledCard state={devices.wled} />
        {tasmotaSources.length > 0 ? (
          tasmotaSources.map((d) => (
            <TasmotaCard
              key={d.state.device_id as string}
              state={d}
              label={`Tasmota — ${d.state.device_id as string}`}
            />
          ))
        ) : (
          <TasmotaCard state={devices.tasmota} />
        )}
      </div>
    </main>
  )
}
