# Signal Interpreter — Phase B Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aligner le frontend sur le nouveau modèle backend basé sur les "units" — supprimer les cards hardcodées par type et le dropdown `interpreter_type`, et les remplacer par une `GenericDeviceCard` pilotée par les units et un formulaire multi-étapes basé sur des presets.

**Architecture:** Réécriture de `registry-api.ts` (nouveaux types + fonctions), création de 7 nouveaux fichiers (icons, 5 widgets, GenericDeviceCard), remplacement du `renderDevice` dans le dashboard, remplacement du formulaire dans `devices/page.tsx`. Les 4 anciennes cards hardcodées sont supprimées.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zustand, Tailwind CSS, shadcn/ui (`Badge`, `Card`), lucide-react

---

## Fichiers — Vue d'ensemble

### Créés
```
apps/frontend/src/
  lib/
    registry-api.ts                           réécriture complète (remplace l'existant)
  components/devices/
    icons.ts                                  whitelist lucide + getIcon()
    GenericDeviceCard.tsx                     card universelle pilotée par les units
    widgets/
      BooleanIndicator.tsx
      NumericValue.tsx
      TextField.tsx
      ColorSwatch.tsx
      EnumBadge.tsx
```

### Modifiés
```
apps/frontend/src/
  app/page.tsx                               remplace renderDevice + imports
  app/devices/page.tsx                       nouveau formulaire multi-étapes
```

### Supprimés
```
apps/frontend/src/components/devices/
  FrigateCard.tsx
  WledCard.tsx
  TasmotaCard.tsx
  GenericCard.tsx
```

### À ne pas toucher (chantier actif)
```
apps/frontend/src/components/devices/TopicsTree.tsx
apps/frontend/src/components/devices/TopicNode.tsx
apps/frontend/src/components/devices/TopicsTree.test.tsx
```

---

## Task 1 : Réécriture de `registry-api.ts`

**Files:**
- Modify: `apps/frontend/src/lib/registry-api.ts`

- [ ] **Step 1 : Remplacer le contenu entier du fichier**

```ts
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

export interface Unit {
  id: number
  device_id: number
  position: number
  name: string
  topic_pattern: string
  json_path: string | null
  condition: object | null
  transform: object
  output_field: string
  output_type: 'boolean' | 'number' | 'string' | 'color' | 'enum'
  display: {
    label?: string
    icon?: string
    unit?: string
    min?: number
    max?: number
    on_label?: string
    off_label?: string
  } | null
}

export type UnitInput = Omit<Unit, 'id' | 'device_id'>

export interface RegistryDevice {
  id: number
  name: string
  debounce_ms: number | null
  layout: {
    groups?: { title?: string; fields: string[] }[]
    hidden?: string[]
  } | null
  units: Unit[]
  active: boolean
  created_at: number
}

export interface DevicePayload {
  name: string
  debounce_ms?: number | null
  layout?: object | null
  units: UnitInput[]
}

export interface Preset {
  key: string
  name: string
  description: string
  debounce_ms: number | null
  placeholders: string[]
  units: UnitInput[]
}

export interface TopicSeen {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export async function fetchRegistry(): Promise<RegistryDevice[]> {
  const res = await fetch(`${API_URL}/api/registry`)
  const data = await res.json() as { devices: RegistryDevice[] }
  return data.devices
}

export async function fetchTopicsSeen(sinceSeconds?: number): Promise<TopicSeen[]> {
  const url = sinceSeconds
    ? `${API_URL}/api/topics?since=${sinceSeconds}`
    : `${API_URL}/api/topics`
  const res = await fetch(url)
  const data = await res.json() as { topics: TopicSeen[] }
  return data.topics
}

export async function fetchPresets(): Promise<Preset[]> {
  const res = await fetch(`${API_URL}/api/presets`)
  const data = await res.json() as { presets: Preset[] }
  return data.presets
}

export async function addDevice(payload: DevicePayload): Promise<number> {
  const res = await fetch(`${API_URL}/api/registry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json() as { id: number }
  return data.id
}

export async function patchDevice(id: number, payload: DevicePayload): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function removeDevice(id: number): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, { method: 'DELETE' })
}

export function applyPresetClient(preset: Preset, vars: Record<string, string>): UnitInput[] {
  return preset.units.map(unit => ({
    ...unit,
    topic_pattern: unit.topic_pattern.replace(/{(\w+)}/g, (_, k) => vars[k] ?? `{${k}}`),
    json_path: unit.json_path?.replace(/{(\w+)}/g, (_, k) => vars[k] ?? `{${k}}`) ?? null,
  }))
}
```

- [ ] **Step 2 : Vérifier que le fichier compile**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected : des erreurs sur `FrigateCard`, `WledCard`, `TasmotaCard`, `GenericCard` et `page.tsx` qui utilisent les anciens types — c'est normal à ce stade. Aucune erreur sur `registry-api.ts` lui-même.

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/lib/registry-api.ts
git commit -m "feat(frontend): réécriture registry-api — types units, presets, patchDevice"
```

---

## Task 2 : `icons.ts` + 5 widgets

**Files:**
- Create: `apps/frontend/src/components/devices/icons.ts`
- Create: `apps/frontend/src/components/devices/widgets/BooleanIndicator.tsx`
- Create: `apps/frontend/src/components/devices/widgets/NumericValue.tsx`
- Create: `apps/frontend/src/components/devices/widgets/TextField.tsx`
- Create: `apps/frontend/src/components/devices/widgets/ColorSwatch.tsx`
- Create: `apps/frontend/src/components/devices/widgets/EnumBadge.tsx`

- [ ] **Step 1 : Créer `icons.ts`**

```ts
import type { ComponentType } from 'react'
import { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer } from 'lucide-react'

export const ICON_MAP = { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer }

export function getIcon(name: string | null | undefined): ComponentType<{ className?: string }> | null {
  if (!name || !(name in ICON_MAP)) return null
  return ICON_MAP[name as keyof typeof ICON_MAP]
}
```

- [ ] **Step 2 : Créer `widgets/BooleanIndicator.tsx`**

```tsx
import type { Unit } from '@/lib/registry-api'

interface Props {
  value: unknown
  display: Unit['display']
}

export function BooleanIndicator({ value, display }: Props) {
  if (value === undefined || value === null) return null
  const on = Boolean(value)
  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${on ? 'bg-green-500' : 'bg-gray-300'}`} />
      <span className="text-sm">{on ? (display?.on_label ?? 'Actif') : (display?.off_label ?? 'Inactif')}</span>
    </div>
  )
}
```

- [ ] **Step 3 : Créer `widgets/NumericValue.tsx`**

```tsx
import type { Unit } from '@/lib/registry-api'

interface Props {
  value: unknown
  display: Unit['display']
}

export function NumericValue({ value, display }: Props) {
  if (value === undefined || value === null) return null
  const num = Number(value)
  const min = display?.min ?? 0
  const max = display?.max ?? 100
  const hasRange = display?.min !== undefined && display?.max !== undefined
  const pct = Math.min(100, Math.max(0, ((num - min) / (max - min)) * 100))

  return (
    <div className="space-y-1">
      <span className="text-sm font-mono">
        {num}{display?.unit ? ` ${display.unit}` : ''}
      </span>
      {hasRange && (
        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4 : Créer `widgets/TextField.tsx`**

```tsx
interface Props {
  value: unknown
}

export function TextField({ value }: Props) {
  if (value === undefined || value === null) return null
  const text = String(value)
  const truncated = text.length > 80 ? text.slice(0, 80) + '…' : text
  return <span className="text-sm" title={text.length > 80 ? text : undefined}>{truncated}</span>
}
```

- [ ] **Step 5 : Créer `widgets/ColorSwatch.tsx`**

```tsx
interface Props {
  value: unknown
}

export function ColorSwatch({ value }: Props) {
  if (value === undefined || value === null) return null
  const hex = String(value)
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-5 w-5 rounded-full border border-border flex-shrink-0"
        style={{ backgroundColor: hex }}
      />
      <span className="text-sm font-mono">{hex}</span>
    </div>
  )
}
```

- [ ] **Step 6 : Créer `widgets/EnumBadge.tsx`**

```tsx
import { Badge } from '@/components/ui/badge'

interface Props {
  value: unknown
}

export function EnumBadge({ value }: Props) {
  if (value === undefined || value === null) return null
  return <Badge variant="secondary">{String(value)}</Badge>
}
```

- [ ] **Step 7 : Vérification**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep -E "icons|widgets|BooleanIndicator|NumericValue|TextField|ColorSwatch|EnumBadge"
```

Expected : aucune ligne de sortie (pas d'erreur sur ces nouveaux fichiers).

- [ ] **Step 8 : Commit**

```bash
git add apps/frontend/src/components/devices/icons.ts apps/frontend/src/components/devices/widgets/
git commit -m "feat(frontend): ajouter icons.ts et les 5 widgets (BooleanIndicator, NumericValue, TextField, ColorSwatch, EnumBadge)"
```

---

## Task 3 : `GenericDeviceCard`

**Files:**
- Create: `apps/frontend/src/components/devices/GenericDeviceCard.tsx`

- [ ] **Step 1 : Créer le fichier**

```tsx
import { DeviceCard } from '@/components/DeviceCard'
import { getIcon } from '@/components/devices/icons'
import { BooleanIndicator } from '@/components/devices/widgets/BooleanIndicator'
import { NumericValue } from '@/components/devices/widgets/NumericValue'
import { TextField } from '@/components/devices/widgets/TextField'
import { ColorSwatch } from '@/components/devices/widgets/ColorSwatch'
import { EnumBadge } from '@/components/devices/widgets/EnumBadge'
import type { RegistryDevice, Unit } from '@/lib/registry-api'
import type { FrontendDeviceState } from '@/store/room'

interface GenericDeviceCardProps {
  device: RegistryDevice
  state: FrontendDeviceState | undefined
}

function renderWidget(unit: Unit, value: unknown) {
  switch (unit.output_type) {
    case 'boolean': return <BooleanIndicator value={value} display={unit.display} />
    case 'number':  return <NumericValue value={value} display={unit.display} />
    case 'string':  return <TextField value={value} />
    case 'color':   return <ColorSwatch value={value} />
    case 'enum':    return <EnumBadge value={value} />
  }
}

interface FieldRowProps {
  unit: Unit
  value: unknown
}

function FieldRow({ unit, value }: FieldRowProps) {
  const widget = renderWidget(unit, value)
  if (!widget) return null
  const Icon = getIcon(unit.display?.icon)
  const label = unit.display?.label ?? unit.name

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        <span>{label}</span>
      </div>
      {widget}
    </div>
  )
}

export function GenericDeviceCard({ device, state }: GenericDeviceCardProps) {
  const unitsByField = Object.fromEntries(device.units.map(u => [u.output_field, u]))

  function renderGroups() {
    return device.layout!.groups!.map((group, i) => (
      <div key={i} className="space-y-2">
        {group.title && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.title}</p>
        )}
        {group.fields.map(field => {
          const unit = unitsByField[field]
          if (!unit) return null
          return <FieldRow key={field} unit={unit} value={state?.state[field]} />
        })}
      </div>
    ))
  }

  function renderFlat() {
    return [...device.units]
      .sort((a, b) => a.position - b.position)
      .map(unit => (
        <FieldRow key={unit.output_field} unit={unit} value={state?.state[unit.output_field]} />
      ))
  }

  return (
    <DeviceCard title={device.name} state={state}>
      <div className="space-y-3">
        {device.layout?.groups ? renderGroups() : renderFlat()}
      </div>
    </DeviceCard>
  )
}
```

- [ ] **Step 2 : Vérification**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep "GenericDeviceCard"
```

Expected : aucune sortie (pas d'erreur).

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/components/devices/GenericDeviceCard.tsx
git commit -m "feat(frontend): GenericDeviceCard — card universelle pilotée par les units"
```

---

## Task 4 : Mise à jour du dashboard `app/page.tsx`

**Files:**
- Modify: `apps/frontend/src/app/page.tsx`

- [ ] **Step 1 : Remplacer le contenu entier du fichier**

```tsx
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
```

- [ ] **Step 2 : Vérification**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep "page.tsx" | grep -v "devices/page"
```

Expected : aucune ligne (pas d'erreur dans `app/page.tsx`).

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/app/page.tsx
git commit -m "feat(frontend): dashboard — remplace renderDevice par GenericDeviceCard"
```

---

## Task 5 : Nouveau formulaire `app/devices/page.tsx`

**Files:**
- Modify: `apps/frontend/src/app/devices/page.tsx`

- [ ] **Step 1 : Remplacer le contenu entier du fichier**

```tsx
'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, RotateCw, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TopicsTree } from '@/components/devices/TopicsTree'
import {
  fetchRegistry, fetchTopicsSeen, fetchPresets,
  addDevice, patchDevice, removeDevice, applyPresetClient,
} from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen, Preset, UnitInput } from '@/lib/registry-api'

type FormMode = 'add' | 'edit'
type FormStep = 'preset' | 'placeholders' | 'units'

function DevicesContent() {
  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [topicsSeen, setTopicsSeen] = useState<TopicSeen[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [mode, setMode] = useState<FormMode>('add')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [step, setStep] = useState<FormStep>('preset')
  const [name, setName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null)
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({})
  const [units, setUnits] = useState<UnitInput[]>([])
  const [formError, setFormError] = useState<string | null>(null)

  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([fetchRegistry(), fetchTopicsSeen(), fetchPresets()])
      .then(([r, t, p]) => { setRegistry(r); setTopicsSeen(t); setPresets(p) })
      .catch(console.error)
  }, [])

  const registeredPatterns = registry.flatMap(d => d.units.map(u => u.topic_pattern))

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      const [r, t] = await Promise.all([fetchRegistry(), fetchTopicsSeen()])
      setRegistry(r)
      setTopicsSeen(t)
    } finally {
      setIsRefreshing(false)
    }
  }

  function resetForm() {
    setMode('add')
    setEditingId(null)
    setStep('preset')
    setName('')
    setSelectedPreset(null)
    setPlaceholderValues({})
    setUnits([])
    setFormError(null)
  }

  function handleSelectTopic(_topic: string) {
    nameInputRef.current?.focus()
  }

  function handleEditDevice(device: RegistryDevice) {
    setMode('edit')
    setEditingId(device.id)
    setName(device.name)
    setSelectedPreset(null)
    setUnits(device.units.map(({ position, name: uname, topic_pattern, json_path, condition, transform, output_field, output_type, display }) => ({
      position, name: uname, topic_pattern, json_path, condition, transform, output_field, output_type, display,
    })))
    setPlaceholderValues({})
    setStep('units')
    setFormError(null)
  }

  async function handleRemove(id: number) {
    await removeDevice(id)
    setRegistry(prev => prev.filter(d => d.id !== id))
  }

  function handlePresetNext() {
    setFormError(null)
    if (!name.trim()) { setFormError('Nom requis'); return }
    if (!selectedPreset) { setFormError('Sélectionnez un preset'); return }
    if (selectedPreset.placeholders.length === 0) {
      setUnits(applyPresetClient(selectedPreset, {}))
      setStep('units')
    } else {
      setPlaceholderValues(Object.fromEntries(selectedPreset.placeholders.map(p => [p, ''])))
      setStep('placeholders')
    }
  }

  function handleGenerateUnits() {
    if (!selectedPreset) return
    setFormError(null)
    setUnits(applyPresetClient(selectedPreset, placeholderValues))
    setStep('units')
  }

  function handleAddUnit() {
    setUnits(prev => [...prev, {
      position: prev.length,
      name: '',
      topic_pattern: '',
      json_path: null,
      condition: null,
      transform: { type: 'passthrough' },
      output_field: '',
      output_type: 'string',
      display: null,
    }])
  }

  function handleResetToPreset() {
    if (!selectedPreset) return
    setUnits(applyPresetClient(selectedPreset, placeholderValues))
  }

  function handleUnitChange(index: number, field: 'topic_pattern' | 'output_field', value: string) {
    setUnits(prev => prev.map((u, i) => i === index ? { ...u, [field]: value } : u))
  }

  function handleDeleteUnit(index: number) {
    setUnits(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setFormError(null)
    if (!name.trim()) { setFormError('Nom requis'); return }
    if (units.length === 0) { setFormError('Au moins un unit requis'); return }
    try {
      const payload = { name: name.trim(), units }
      if (mode === 'edit' && editingId !== null) {
        await patchDevice(editingId, payload)
      } else {
        await addDevice(payload)
      }
      const updated = await fetchRegistry()
      setRegistry(updated)
      resetForm()
    } catch {
      setFormError("Erreur lors de l'enregistrement")
    }
  }

  const formTitle = mode === 'edit' ? 'Modifier le device' : 'Ajouter un device'

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Gestion des devices</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-6">
        {/* Colonne 1 — Liste des devices */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Devices configurés ({registry.length})</h2>
          {registry.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun device configuré</p>
          )}
          {registry.map(device => (
            <Card key={device.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {device.name}
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditDevice(device)}
                      aria-label="Éditer"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemove(device.id)}
                      aria-label="Supprimer"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant={device.active ? 'default' : 'secondary'}>
                  {device.active ? 'Actif' : 'Inactif'}
                </Badge>
                <p className="text-xs text-muted-foreground">{device.units.length} unit(s)</p>
                <div className="space-y-1">
                  {device.units.slice(0, 3).map((u, i) => (
                    <p key={i} className="text-xs font-mono text-muted-foreground truncate">{u.topic_pattern}</p>
                  ))}
                  {device.units.length > 3 && (
                    <p className="text-xs text-muted-foreground">+{device.units.length - 3} autres</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Colonne 2 — Topics découverts */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Topics découverts</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Rafraîchir"
            >
              <RotateCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <TopicsTree
            topics={topicsSeen}
            registeredPatterns={registeredPatterns}
            onSelectTopic={handleSelectTopic}
          />
        </section>

        {/* Colonne 3 — Formulaire multi-étapes */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{formTitle}</h2>
            {mode === 'edit' && (
              <Button variant="ghost" size="sm" onClick={resetForm}>Annuler</Button>
            )}
          </div>

          {step === 'preset' && (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="device-name">Nom</label>
                <input
                  id="device-name"
                  ref={nameInputRef}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Mon capteur"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="preset-select">Preset</label>
                <select
                  id="preset-select"
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  value={selectedPreset?.key ?? ''}
                  onChange={e => setSelectedPreset(presets.find(p => p.key === e.target.value) ?? null)}
                >
                  <option value="">— Sélectionner un preset —</option>
                  {presets.map(p => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
                {selectedPreset && (
                  <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
                )}
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button onClick={handlePresetNext} className="w-full">Suivant</Button>
            </div>
          )}

          {step === 'placeholders' && selectedPreset && (
            <div className="space-y-4">
              {selectedPreset.placeholders.map(placeholder => (
                <div key={placeholder} className="space-y-1">
                  <label className="text-sm font-medium" htmlFor={`ph-${placeholder}`}>{placeholder}</label>
                  <input
                    id={`ph-${placeholder}`}
                    className="w-full border rounded px-3 py-2 text-sm font-mono bg-background"
                    value={placeholderValues[placeholder] ?? ''}
                    onChange={e => setPlaceholderValues(prev => ({ ...prev, [placeholder]: e.target.value }))}
                    placeholder={`{${placeholder}}`}
                  />
                </div>
              ))}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('preset')} className="flex-1">Retour</Button>
                <Button onClick={handleGenerateUnits} className="flex-1">Générer les units</Button>
              </div>
            </div>
          )}

          {step === 'units' && (
            <div className="space-y-4">
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {units.map((unit, index) => (
                  <Card key={index}>
                    <CardContent className="pt-3 space-y-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">topic_pattern</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-xs font-mono bg-background"
                          value={unit.topic_pattern}
                          onChange={e => handleUnitChange(index, 'topic_pattern', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">output_field</label>
                        <input
                          className="w-full border rounded px-2 py-1 text-xs font-mono bg-background"
                          value={unit.output_field}
                          onChange={e => handleUnitChange(index, 'output_field', e.target.value)}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>transform: {(unit.transform as { type?: string }).type ?? '?'}</span>
                        {unit.json_path && (
                          <span className="font-mono truncate max-w-[120px]" title={unit.json_path}>{unit.json_path}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleDeleteUnit(index)}
                          aria-label="Supprimer l'unit"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button variant="outline" onClick={handleAddUnit} className="w-full">Ajouter un unit</Button>
              {mode === 'add' && selectedPreset && (
                <Button variant="outline" onClick={handleResetToPreset} className="w-full">Reset au preset</Button>
              )}
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button onClick={handleSave} className="w-full">Enregistrer</Button>
            </div>
          )}
        </section>
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
```

- [ ] **Step 2 : Vérification**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep "devices/page"
```

Expected : aucune ligne d'erreur sur ce fichier.

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/app/devices/page.tsx
git commit -m "feat(frontend): formulaire multi-étapes preset/placeholders/units avec mode édition"
```

---

## Task 6 : Suppression des anciennes cards + vérification finale

**Files:**
- Delete: `apps/frontend/src/components/devices/FrigateCard.tsx`
- Delete: `apps/frontend/src/components/devices/WledCard.tsx`
- Delete: `apps/frontend/src/components/devices/TasmotaCard.tsx`
- Delete: `apps/frontend/src/components/devices/GenericCard.tsx`

- [ ] **Step 1 : Supprimer les 4 fichiers**

```bash
rm apps/frontend/src/components/devices/FrigateCard.tsx \
   apps/frontend/src/components/devices/WledCard.tsx \
   apps/frontend/src/components/devices/TasmotaCard.tsx \
   apps/frontend/src/components/devices/GenericCard.tsx
```

- [ ] **Step 2 : Vérification TypeScript complète**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1
```

Expected : aucune sortie (zéro erreur). Si des erreurs apparaissent, elles indiquent un fichier qui importe encore une des anciennes cards — les corriger avant de continuer.

- [ ] **Step 3 : Lancer la suite de tests existante**

```bash
cd apps/frontend && npx vitest run 2>&1
```

Expected : tous les tests passent. Les tests existants couvrent `TopicsTree`, `mqtt-matcher`, `topics-tree` et `ws` — aucun ne touche les cards ou le formulaire, donc aucune régression attendue.

- [ ] **Step 4 : Commit final**

```bash
git add -u
git commit -m "feat(frontend): supprimer FrigateCard, WledCard, TasmotaCard, GenericCard — Phase B complète"
```

---

## Récapitulatif des critères de réussite

| Critère | Vérification |
|---|---|
| Dashboard sans `interpreter_type` | `grep -r "interpreter_type" apps/frontend/src` → aucune ligne |
| TypeScript sans erreur | `cd apps/frontend && npx tsc --noEmit` → sortie vide |
| Tests sans régression | `cd apps/frontend && npx vitest run` → tous verts |
| GenericDeviceCard utilisée | `grep -r "FrigateCard\|WledCard\|TasmotaCard" apps/frontend/src` → aucune ligne |
