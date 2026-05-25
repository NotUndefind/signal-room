import { Plug, Zap, Thermometer } from 'lucide-react'
import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface TasmotaCardProps {
  state: FrontendDeviceState | undefined
  label?: string
}

export function TasmotaCard({ state, label = 'Tasmota' }: TasmotaCardProps) {
  const s = state?.state as {
    power?: boolean
    watt?: number
    voltage?: number
    kwh_today?: number
    temperature?: number
    humidity?: number
    device_id?: string
  } | undefined

  return (
    <DeviceCard title={label} state={state}>
      {s && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Plug className={`h-5 w-5 ${s.power ? 'text-green-500' : 'text-gray-400'}`} />
            <span className="font-medium">{s.power ? 'Allumé' : 'Éteint'}</span>
          </div>
          {s.watt !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>{s.watt} W</span>
              {s.kwh_today !== undefined && (
                <span className="text-muted-foreground">— {s.kwh_today} kWh aujourd&apos;hui</span>
              )}
            </div>
          )}
          {s.temperature !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <Thermometer className="h-4 w-4 text-blue-500" />
              <span>{s.temperature}°C</span>
              {s.humidity !== undefined && <span className="text-muted-foreground">· {s.humidity}%</span>}
            </div>
          )}
        </div>
      )}
    </DeviceCard>
  )
}
