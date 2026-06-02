'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  initialName: string
  initialDescription?: string
  submitLabel?: string
  onSave: (data: { name: string; description: string }) => void
  onClose: () => void
}

export function SavePresetModal({
  open, initialName, initialDescription = '', submitLabel = 'Sauvegarder',
  onSave, onClose,
}: Props) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
      setError(null)
    }
  }, [open, initialName, initialDescription])

  if (!open) return null

  function handleSubmit() {
    if (!name.trim()) { setError('Nom requis'); return }
    onSave({ name: name.trim(), description: description.trim() })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="bg-background border rounded-lg p-6 w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Sauvegarder comme preset</h3>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="preset-name">Nom</label>
          <input
            id="preset-name"
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="preset-desc">Description</label>
          <textarea
            id="preset-desc"
            rows={3}
            className="w-full border rounded px-3 py-2 text-sm bg-background"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleSubmit}>{submitLabel}</Button>
        </div>
      </div>
    </div>
  )
}
