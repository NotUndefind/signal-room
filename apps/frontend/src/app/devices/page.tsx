'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { fetchRegistry, fetchTopicsSeen, addDevice, removeDevice } from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen } from '@/lib/registry-api'

const INTERPRETER_TYPES = ['raw', 'frigate', 'tasmota', 'wled'] as const

function DevicesContent() {
  const searchParams = useSearchParams()
  const prefillTopic = searchParams.get('topic') ?? ''

  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [topicsSeen, setTopicsSeen] = useState<TopicSeen[]>([])
  const [name, setName] = useState('')
  const [topicPattern, setTopicPattern] = useState(prefillTopic)
  const [interpreterType, setInterpreterType] = useState<string>('raw')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
    fetchTopicsSeen().then(setTopicsSeen).catch(console.error)
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !topicPattern.trim()) {
      setError('Nom et topic requis')
      return
    }
    try {
      const id = await addDevice({
        name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType,
      })
      setRegistry(prev => [...prev, {
        id, name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType as RegistryDevice['interpreter_type'],
        active: 1,
        created_at: Date.now(),
      }])
      setName('')
      setTopicPattern('')
    } catch {
      setError("Erreur lors de l'ajout")
    }
  }

  async function handleRemove(id: number) {
    await removeDevice(id)
    setRegistry(prev => prev.filter(d => d.id !== id))
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Gestion des devices</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Devices configurés ({registry.length})</h2>
          {registry.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun device configuré</p>
          )}
          {registry.map(device => (
            <Card key={device.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {device.name}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(device.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary">{device.interpreter_type}</Badge>
                <div className="space-y-1">
                  {device.topic_patterns.map(p => (
                    <p key={p} className="text-xs font-mono text-muted-foreground">{p}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Ajouter un device</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-name">Nom</label>
              <input
                id="device-name"
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Mon capteur"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-topic">Topic MQTT</label>
              <input
                id="device-topic"
                className="w-full border rounded px-3 py-2 text-sm font-mono bg-background"
                value={topicPattern}
                onChange={e => setTopicPattern(e.target.value)}
                placeholder="home/sensor/temp"
                list="topics-datalist"
              />
              <datalist id="topics-datalist">
                {topicsSeen.map(t => <option key={t.topic} value={t.topic} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                Les topics vus apparaissent en suggestion. Wildcards MQTT supportés : + et #
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-type">Type d&apos;interpréteur</label>
              <select
                id="device-type"
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={interpreterType}
                onChange={e => setInterpreterType(e.target.value)}
              >
                {INTERPRETER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Ajouter</Button>
          </form>
        </div>
      </div>
    </main>
  )
}

export default function DevicesPage() {
  return (
    <Suspense>
      <DevicesContent />
    </Suspense>
  )
}
