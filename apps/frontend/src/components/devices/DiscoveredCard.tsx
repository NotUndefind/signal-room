import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TopicSeen } from '@/lib/registry-api'

interface DiscoveredCardProps {
  topic: TopicSeen
  onConfigure: (topic: string) => void
}

export function DiscoveredCard({ topic, onConfigure }: DiscoveredCardProps) {
  const lastSeen = new Date(topic.last_seen).toLocaleTimeString('fr-FR')

  return (
    <Card className="opacity-70 border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="font-mono text-sm truncate">{topic.topic}</span>
          <span className="text-xs text-muted-foreground font-normal ml-2 shrink-0">{lastSeen}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {topic.detected_type && (
            <Badge variant="secondary">{topic.detected_type}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {topic.message_count} message{topic.message_count > 1 ? 's' : ''}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => onConfigure(topic.topic)}>
          Configurer
        </Button>
      </CardContent>
    </Card>
  )
}
