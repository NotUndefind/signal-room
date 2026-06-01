interface Props {
  value: unknown
}

export function ColorSwatch({ value }: Props) {
  if (value === undefined || value === null) return null
  const hex = String(value)
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-5 w-5 rounded-full border border-border flex-shrink-0"
        style={{ backgroundColor: hex }}
      />
      <span className="text-sm font-mono">{hex}</span>
    </div>
  )
}
