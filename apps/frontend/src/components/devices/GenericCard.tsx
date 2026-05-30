import { DeviceCard } from '@/components/DeviceCard'
import type { FrontendDeviceState } from '@/store/room'

interface GenericCardProps {
  name: string
  state: FrontendDeviceState | undefined
}

export function GenericCard({ name, state }: GenericCardProps) {
  const payload = state?.state?.payload

  return (
    <DeviceCard title={name} state={state}>
      {payload !== undefined && (
        <pre className="text-xs overflow-auto max-h-48 bg-muted p-2 rounded font-mono">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </DeviceCard>
  )
}
