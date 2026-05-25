import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { FrontendDeviceState } from '@/store/room'

interface DeviceCardProps {
  title: string
  state: FrontendDeviceState | undefined
  children?: React.ReactNode
}

export function DeviceCard({ title, state, children }: DeviceCardProps) {
  const isActive = !!state
  const lastSeen = state ? new Date(state.timestamp).toLocaleTimeString('fr-FR') : null

  return (
    <Card className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-50'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          {title}
          <span className="text-xs text-muted-foreground font-normal">
            {lastSeen ? `Mis à jour ${lastSeen}` : 'En attente...'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isActive ? children : (
          <p className="text-sm text-muted-foreground">Aucune donnée reçue</p>
        )}
      </CardContent>
    </Card>
  )
}
