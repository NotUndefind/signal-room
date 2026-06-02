'use client'

import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type TransformType =
  | 'passthrough' | 'enum_map' | 'scale' | 'round'
  | 'rgb_to_hex' | 'array_first' | 'array_contains'

export type Transform =
  | { type: 'passthrough' }
  | { type: 'enum_map'; map: Record<string, unknown>; default?: unknown }
  | { type: 'scale'; in_min: number; in_max: number; out_min: number; out_max: number; round?: boolean }
  | { type: 'round'; decimals: number }
  | { type: 'rgb_to_hex' }
  | { type: 'array_first' }
  | { type: 'array_contains'; value: string | number }

interface Props {
  value: Transform
  onChange: (t: Transform) => void
}

const TYPES: TransformType[] = [
  'passthrough', 'scale', 'round', 'enum_map',
  'rgb_to_hex', 'array_first', 'array_contains',
]

function defaultFor(type: TransformType): Transform {
  switch (type) {
    case 'passthrough': return { type: 'passthrough' }
    case 'scale': return { type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: false }
    case 'round': return { type: 'round', decimals: 2 }
    case 'enum_map': return { type: 'enum_map', map: {} }
    case 'rgb_to_hex': return { type: 'rgb_to_hex' }
    case 'array_first': return { type: 'array_first' }
    case 'array_contains': return { type: 'array_contains', value: '' }
  }
}

export function TransformEditor({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="transform-type">
          type
        </label>
        <select
          id="transform-type"
          className="w-full border rounded px-2 py-1 text-xs bg-background"
          value={value.type}
          onChange={e => onChange(defaultFor(e.target.value as TransformType))}
        >
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {value.type === 'scale' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="in_min" value={value.in_min}
            onChange={v => onChange({ ...value, in_min: v })} />
          <NumberField label="in_max" value={value.in_max}
            onChange={v => onChange({ ...value, in_max: v })} />
          <NumberField label="out_min" value={value.out_min}
            onChange={v => onChange({ ...value, out_min: v })} />
          <NumberField label="out_max" value={value.out_max}
            onChange={v => onChange({ ...value, out_max: v })} />
          <label className="flex items-center gap-2 text-xs col-span-2">
            <input
              type="checkbox"
              checked={value.round ?? false}
              onChange={e => onChange({ ...value, round: e.target.checked })}
            />
            round (arrondir le résultat)
          </label>
        </div>
      )}

      {value.type === 'round' && (
        <NumberField label="decimals" value={value.decimals}
          onChange={v => onChange({ ...value, decimals: v })} />
      )}

      {value.type === 'enum_map' && (
        <EnumMapEditor
          map={value.map}
          defaultValue={value.default}
          onChange={(map, def) => onChange({ ...value, map, default: def })}
        />
      )}

      {value.type === 'array_contains' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="contains-value">
            value
          </label>
          <input
            id="contains-value"
            className="w-full border rounded px-2 py-1 text-xs bg-background"
            value={String(value.value)}
            onChange={e => onChange({ ...value, value: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

function NumberField({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  const id = `nf-${label}`
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        className="w-full border rounded px-2 py-1 text-xs bg-background"
        defaultValue={value}
        onChange={e => {
          const n = Number(e.target.value)
          if (e.target.value !== '' && !isNaN(n)) onChange(n)
        }}
      />
    </div>
  )
}

function EnumMapEditor({
  map, defaultValue, onChange,
}: {
  map: Record<string, unknown>
  defaultValue: unknown
  onChange: (map: Record<string, unknown>, def: unknown) => void
}) {
  const entries = Object.entries(map)
  function updateKey(oldKey: string, newKey: string) {
    if (newKey === oldKey || newKey === '') return
    const next: Record<string, unknown> = {}
    for (const [k, v] of entries) next[k === oldKey ? newKey : k] = v
    onChange(next, defaultValue)
  }
  function updateValue(key: string, newVal: string) {
    onChange({ ...map, [key]: newVal }, defaultValue)
  }
  function removeEntry(key: string) {
    const next = { ...map }
    delete next[key]
    onChange(next, defaultValue)
  }
  function addEntry() {
    const base = 'new_key'
    let key = base
    let i = 1
    while (key in map) { key = `${base}_${i++}` }
    onChange({ ...map, [key]: '' }, defaultValue)
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">map (clé → valeur)</p>
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1 items-center">
          <input
            aria-label={`key-${k}`}
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            defaultValue={k}
            onBlur={e => updateKey(k, e.target.value)}
          />
          <span className="text-xs">→</span>
          <input
            aria-label={`value-${k}`}
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            value={String(v)}
            onChange={e => updateValue(k, e.target.value)}
          />
          <Button
            variant="ghost" size="icon" className="h-6 w-6"
            onClick={() => removeEntry(k)} aria-label={`Supprimer paire ${k}`}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addEntry}>
        Ajouter une paire
      </Button>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="enum-default">
          default (optionnel)
        </label>
        <input
          id="enum-default"
          className="w-full border rounded px-2 py-1 text-xs bg-background"
          value={defaultValue === undefined ? '' : String(defaultValue)}
          onChange={e => onChange(map, e.target.value === '' ? undefined : e.target.value)}
        />
      </div>
    </div>
  )
}
