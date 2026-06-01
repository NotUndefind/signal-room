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
    try {
      await removeDevice(id)
      setRegistry(prev => prev.filter(d => d.id !== id))
    } catch {
      setFormError('Erreur lors de la suppression')
    }
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
                    className="w-full border rounded px-2 py-1 text-sm font-mono bg-background"
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
                  <Card key={unit.output_field || index}>
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
    <Suspense fallback={null}>
      <DevicesContent />
    </Suspense>
  )
}
