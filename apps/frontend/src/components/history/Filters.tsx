'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'

interface FiltersProps {
  source: string
  onSourceChange: (value: string) => void
  onReset: () => void
}

const SOURCES = ['frigate', 'wled', 'tasmota']

export function Filters({ source, onSourceChange, onReset }: FiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Select value={source} onValueChange={onSourceChange}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les sources</SelectItem>
          {SOURCES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {source !== 'all' && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X className="h-4 w-4 mr-1" />
          Réinitialiser
        </Button>
      )}
    </div>
  )
}
