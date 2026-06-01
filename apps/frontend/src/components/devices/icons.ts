import type { ComponentType } from 'react'
import { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer } from 'lucide-react'

export const ICON_MAP = { User, Camera, Lightbulb, Sun, Plug, Zap, Thermometer }

export function getIcon(name: string | null | undefined): ComponentType<{ className?: string }> | null {
  if (!name || !(name in ICON_MAP)) return null
  return ICON_MAP[name as keyof typeof ICON_MAP]
}
