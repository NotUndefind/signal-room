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
  createCustomPreset, updateCustomPreset, deleteCustomPreset,
} from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen, Preset, UnitInput } from '@/lib/registry-api'
import { UnitEditor } from '@/components/devices/UnitEditor'
import { SavePresetModal } from '@/components/devices/SavePresetModal'

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
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [presetDraft, setPresetDraft] = useState<{ name: string; description: string }>({ name: '', description: '' })
  const [resetCount, setResetCount] = useState(0)

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
    setResetCount(c => c + 1)
  }

  function handleUnitReplace(index: number, next: UnitInput) {
    setUnits(prev => prev.map((u, i) => i === index ? next : u))
  }

  function handleDeleteUnit(index: number) {
    setUnits(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    setFormError(null)
    if (!name.trim()) { setFormError('Nom requis'); return }
    if (units.length === 0) { setFormError('Au moins un unit requis'); return }
    try {
      const normalizedUnits = units.map((u, i) => ({
        ...u,
        name: u.name || u.output_field || `unit_${i}`,
      }))
      const payload = { name: name.trim(), units: normalizedUnits }
      if (mode === 'edit' && editingId !== null) {
        await patchDevice(editingId, payload)
      } else {
        await addDevice(payload)
      }
      const updated = await fetchRegistry()
      setRegistry(updated)
      resetForm()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement")
    }
  }

  function handleOpenSaveModal() {
    if (!name.trim() && !presetDraft.name) {
      setFormError('Renseignez d\'abord le nom du device ou ouvrez la modale après')
      return
    }
    setFormError(null)
    if (!editingPresetId) {
      setPresetDraft({ name: name.trim() || 'Mon preset', description: '' })
    }
    setSaveModalOpen(true)
  }

  async function handleSavePreset(data: { name: string; description: string }) {
    try {
      if (editingPresetId) {
        await updateCustomPreset(editingPresetId, { ...data, units })
      } else {
        await createCustomPreset({ ...data, units })
      }
      const refreshed = await fetchPresets()
      setPresets(refreshed)
      setSaveModalOpen(false)
      setEditingPresetId(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde du preset')
    }
  }

  function handleEditCustomPreset(preset: Preset) {
    if (preset.source !== 'custom' || !preset.id) return
    setMode('add')
    setEditingId(null)
    setEditingPresetId(preset.id)
    setSelectedPreset(preset)
    setName('')
    setUnits(applyPresetClient(preset, {}))
    setPlaceholderValues({})
    setPresetDraft({ name: preset.name, description: preset.description })
    setStep('units')
    setFormError(null)
  }

  async function handleDeleteCustomPreset(preset: Preset) {
    if (preset.source !== 'custom' || !preset.id) return
    if (!confirm(`Supprimer le preset "${preset.name}" ?`)) return
    try {
      await deleteCustomPreset(preset.id)
      const refreshed = await fetchPresets()
      setPresets(refreshed)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erreur lors de la suppression')
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
                <label className="text-sm font-medium">Preset</label>
                <div className="border rounded max-h-72 overflow-y-auto divide-y">
                  {presets.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2">Aucun preset disponible</p>
                  )}
                  {presets.map(p => {
                    const isSelected = selectedPreset?.key === p.key
                    return (
                      <div
                        key={p.key}
                        className={`flex items-center justify-between p-2 text-sm cursor-pointer hover:bg-muted ${isSelected ? 'bg-muted' : ''}`}
                        onClick={() => setSelectedPreset(p)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate">{p.name}</span>
                            {p.source === 'custom' && <Badge variant="secondary">Custom</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                        </div>
                        {p.source === 'custom' && (
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={e => { e.stopPropagation(); handleEditCustomPreset(p) }}
                              aria-label="Éditer le preset"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={e => { e.stopPropagation(); handleDeleteCustomPreset(p) }}
                              aria-label="Supprimer le preset"
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
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
                  <UnitEditor
                    key={`${selectedPreset?.key ?? 'no-preset'}-${editingPresetId ?? 'new'}-${editingId ?? 'new'}-${resetCount}-${index}`}
                    unit={unit}
                    onChange={next => handleUnitReplace(index, next)}
                    onDelete={() => handleDeleteUnit(index)}
                  />
                ))}
              </div>
              <Button variant="outline" onClick={handleAddUnit} className="w-full">Ajouter un unit</Button>
              {mode === 'add' && selectedPreset && (
                <Button variant="outline" onClick={handleResetToPreset} className="w-full">Reset au preset</Button>
              )}
              <Button variant="outline" onClick={handleOpenSaveModal} className="w-full">
                {editingPresetId ? 'Mettre à jour le preset' : 'Sauvegarder comme preset'}
              </Button>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <Button onClick={handleSave} className="w-full">Enregistrer le device</Button>
            </div>
          )}
        </section>
      </div>
      <SavePresetModal
        open={saveModalOpen}
        initialName={presetDraft.name}
        initialDescription={presetDraft.description}
        submitLabel={editingPresetId ? 'Mettre à jour' : 'Sauvegarder'}
        onSave={handleSavePreset}
        onClose={() => setSaveModalOpen(false)}
      />
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
