import { Lightbulb } from 'lucide-react'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface WledCardProps {
  state: FrontendDeviceState | undefined
}

export function WledCard({ state }: WledCardProps) {
  const s = state?.state as { power?: boolean; brightness?: number; color?: string; effect_id?: number } | undefined

  return (
    <DeviceCard title="WLED" state={state}>
      {s && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className={`h-5 w-5 ${s.power ? 'text-yellow-500' : 'text-gray-400'}`} />
            <span className="font-medium">{s.power ? 'Allumé' : 'Éteint'}</span>
          </div>
          {s.power && (
            <>
              <div className="flex items-center gap-3">
                <div
                  className="h-6 w-6 rounded-full border border-border flex-shrink-0"
                  style={{ backgroundColor: s.color ?? '#ffffff' }}
                />
                <span className="text-sm text-muted-foreground">{s.color}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div
                    className="bg-yellow-400 h-2 rounded-full"
                    style={{ width: `${s.brightness ?? 0}%` }}
                  />
                </div>
                <span className="text-muted-foreground w-10 text-right">{s.brightness}%</span>
              </div>
            </>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
