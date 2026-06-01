'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { History, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { GenericDeviceCard } from '@/components/devices/GenericDeviceCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'
import { fetchRegistry } from '@/lib/registry-api'
import type { RegistryDevice } from '@/lib/registry-api'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()
  const [registry, setRegistry] = useState<RegistryDevice[]>([])

  useEffect(() => {
    const client = createWsClient({
      url: WS_URL,
      onSnapshot: setDevices,
      onUpdate: setDevice,
      onConnectionChange: setConnected,
    })
    return () => client.disconnect()
  }, [setDevice, setDevices, setConnected])

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
  }, [])

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
            <Link href="/devices">
              <Settings className="h-4 w-4 mr-2" />
              Devices
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {registry.filter(d => d.active).map(device => (
          <GenericDeviceCard
            key={device.id}
            device={device}
            state={devices[`device:${device.id}`]}
          />
        ))}
      </div>
    </main>
  )
}
