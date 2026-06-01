interface Props {
  value: unknown
}

export function TextField({ value }: Props) {
  if (value === undefined || value === null) return null
  const text = String(value)
  const truncated = text.length > 80 ? text.slice(0, 80) + '…' : text
  return <span className="text-sm" title={text.length > 80 ? text : undefined}>{truncated}</span>
}
