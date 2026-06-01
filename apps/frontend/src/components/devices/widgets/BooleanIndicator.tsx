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
