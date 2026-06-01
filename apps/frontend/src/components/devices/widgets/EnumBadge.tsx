import { Badge } from '@/components/ui/badge'

interface Props {
  value: unknown
}

export function EnumBadge({ value }: Props) {
  if (value === undefined || value === null) return null
  return <Badge variant="secondary">{String(value)}</Badge>
}
