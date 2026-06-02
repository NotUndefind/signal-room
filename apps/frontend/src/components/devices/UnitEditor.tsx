'use client'

import { useState } from 'react'
import { Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TransformEditor, type Transform } from './TransformEditor'
import type { UnitInput } from '@/lib/registry-api'

interface Props {
  unit: UnitInput
  onChange: (u: UnitInput) => void
  onDelete: () => void
}

export function UnitEditor({ unit, onChange, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const label = unit.display?.label || unit.output_field || '(sans label)'

  function patch(partial: Partial<UnitInput>) {
    onChange({ ...unit, ...partial })
  }
  function patchDisplay(partial: Partial<NonNullable<UnitInput['display']>>) {
    onChange({ ...unit, display: { ...(unit.display ?? {}), ...partial } })
  }

  return (
    <Card>
      <CardContent className="pt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-medium text-left flex-1 min-w-0"
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Replier' : 'Modifier'}
          >
            {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
            <span className="truncate">{label}</span>
          </button>
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={onDelete} aria-label="Supprimer l'unit"
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>

        {!open && (
          <p className="text-xs font-mono text-muted-foreground truncate">
            {unit.topic_pattern}
          </p>
        )}

        {open && (
          <div className="space-y-2 pt-1 border-t">
            <TextField
              label="output_field" value={unit.output_field}
              onChange={v => patch({ output_field: v })}
            />
            <TextField
              label="label" value={unit.display?.label ?? ''}
              onChange={v => patchDisplay({ label: v })}
            />
            <TextField
              label="topic_pattern" value={unit.topic_pattern}
              onChange={v => patch({ topic_pattern: v })}
            />
            <TextField
              label="json_path" value={unit.json_path ?? ''}
              onChange={v => patch({ json_path: v === '' ? null : v })}
            />
            <div className="pt-1">
              <TransformEditor
                value={unit.transform as Transform}
                onChange={t => patch({ transform: t })}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TextField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `uf-${label}`
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="w-full border rounded px-2 py-1 text-xs font-mono bg-background"
        defaultValue={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
