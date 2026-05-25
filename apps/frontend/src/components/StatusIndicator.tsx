'use client'

interface StatusIndicatorProps {
  connected: boolean
}

export function StatusIndicator({ connected }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400 animate-pulse'}`}
      />
      <span className={connected ? 'text-green-600' : 'text-gray-500'}>
        {connected ? 'Connected' : 'Reconnecting...'}
      </span>
    </div>
  )
}
