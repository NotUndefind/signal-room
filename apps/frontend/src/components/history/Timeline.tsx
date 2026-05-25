import { Badge } from '@/components/ui/badge'
import type { StoredEvent } from '@/lib/api'

interface TimelineProps {
  events: StoredEvent[]
}

const SOURCE_COLORS: Record<string, string> = {
  frigate: 'bg-blue-100 text-blue-800',
  wled: 'bg-yellow-100 text-yellow-800',
  tasmota: 'bg-green-100 text-green-800',
}

const EVENT_LABELS: Record<string, string> = {
  detection_start: 'Début de détection',
  detection_end: 'Fin de détection',
  state_change: "Changement d'état",
  sensor_update: 'Mise à jour capteur',
  power_update: 'Mise à jour énergie',
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (days > 0) return `il y a ${days}j`
  if (hours > 0) return `il y a ${hours}h`
  if (minutes > 0) return `il y a ${minutes}min`
  return "à l'instant"
}

export function Timeline({ events }: TimelineProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm py-8 text-center">Aucun événement</p>
  }

  return (
    <div className="space-y-2">
      {events.map((event) => {
        const colorClass = SOURCE_COLORS[event.source] ?? 'bg-gray-100 text-gray-800'
        const label = EVENT_LABELS[event.event_type] ?? event.event_type
        const absoluteTime = new Date(event.created_at).toLocaleString('fr-FR')

        return (
          <div
            key={event.id}
            className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
          >
            <Badge className={`${colorClass} border-0 flex-shrink-0 mt-0.5`}>
              {event.source}
            </Badge>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {JSON.stringify(JSON.parse(event.payload))}
              </p>
            </div>
            <time
              className="text-xs text-muted-foreground flex-shrink-0"
              title={absoluteTime}
            >
              {relativeTime(event.created_at)}
            </time>
          </div>
        )
      })}
    </div>
  )
}
