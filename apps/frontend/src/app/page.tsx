'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { History, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { FrigateCard } from '@/components/devices/FrigateCard'
import { WledCard } from '@/components/devices/WledCard'
import { TasmotaCard } from '@/components/devices/TasmotaCard'
import { GenericCard } from '@/components/devices/GenericCard'
import { DiscoveredCard } from '@/components/devices/DiscoveredCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'
import { fetchRegistry, fetchTopicsSeen } from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen } from '@/lib/registry-api'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()
  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [discoveredTopics, setDiscoveredTopics] = useState<TopicSeen[]>([])
  const router = useRouter()

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
    fetchTopicsSeen(86400).then(setDiscoveredTopics).catch(console.error)
  }, [])

  const registeredPatterns = new Set(registry.flatMap(d => d.topic_patterns))
  const unregisteredTopics = discoveredTopics.filter(t => !registeredPatterns.has(t.topic))

  function renderDevice(device: RegistryDevice): React.ReactNode[] {
    if (device.interpreter_type === 'frigate') {
      const sources = Object.values(devices).filter(d => d.source === 'frigate')
      if (sources.length === 0) return [<FrigateCard key={`frigate-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <FrigateCard key={String(d.state.camera ?? device.id)} state={d} />
      ))
    }
    if (device.interpreter_type === 'tasmota') {
      const sources = Object.values(devices).filter(d => d.source === 'tasmota')
      if (sources.length === 0) return [<TasmotaCard key={`tasmota-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <TasmotaCard
          key={d.state.device_id as string}
          state={d}
          label={`Tasmota — ${d.state.device_id as string}`}
        />
      ))
    }
    if (device.interpreter_type === 'wled') {
      return [<WledCard key={`wled-${device.id}`} state={devices['wled']} />]
    }
    if (device.interpreter_type === 'raw') {
      const topic = device.topic_patterns[0] ?? ''
      return [<GenericCard key={`raw-${device.id}`} name={device.name} state={devices[`raw:${topic}`]} />]
    }
    return []
  }

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
        {registry.filter(d => d.active).flatMap(renderDevice)}
        {unregisteredTopics.map(topic => (
          <DiscoveredCard
            key={topic.topic}
            topic={topic}
            onConfigure={(t) => router.push(`/devices?topic=${encodeURIComponent(t)}`)}
          />
        ))}
      </div>
    </main>
  )
}
