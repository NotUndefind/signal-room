import { User, Camera } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface FrigateCardProps {
  state: FrontendDeviceState | undefined
}

export function FrigateCard({ state }: FrigateCardProps) {
  const s = state?.state as { object?: string; zone?: string; confidence?: number; camera?: string; active?: boolean } | undefined

  return (
    <DeviceCard title="Frigate" state={state}>
      {s && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <User className={`h-5 w-5 ${s.active ? 'text-blue-500' : 'text-gray-400'}`} />
            <span className="font-medium">
              {s.active ? `${s.object ?? 'Objet'} détecté` : 'Aucune détection'}
            </span>
          </div>
          {s.zone && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera className="h-4 w-4" />
              <span>{s.camera} — {s.zone}</span>
            </div>
          )}
          {s.confidence !== undefined && (
            <Badge variant={s.active ? 'default' : 'secondary'}>
              Confiance : {Math.round(s.confidence * 100)}%
            </Badge>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
