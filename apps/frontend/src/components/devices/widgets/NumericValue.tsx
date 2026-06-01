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
