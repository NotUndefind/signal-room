import { DeviceCard } from '@/components/DeviceCard'
import { getIcon } from '@/components/devices/icons'
import { BooleanIndicator } from '@/components/devices/widgets/BooleanIndicator'
import { NumericValue } from '@/components/devices/widgets/NumericValue'
import { TextField } from '@/components/devices/widgets/TextField'
import { ColorSwatch } from '@/components/devices/widgets/ColorSwatch'
import { EnumBadge } from '@/components/devices/widgets/EnumBadge'
import type { RegistryDevice, Unit } from '@/lib/registry-api'
import type { FrontendDeviceState } from '@/store/room'

interface GenericDeviceCardProps {
  device: RegistryDevice
  state: FrontendDeviceState | undefined
}

function renderWidget(unit: Unit, value: unknown) {
  switch (unit.output_type) {
    case 'boolean': return <BooleanIndicator value={value} display={unit.display} />
    case 'number':  return <NumericValue value={value} display={unit.display} />
    case 'string':  return <TextField value={value} />
    case 'color':   return <ColorSwatch value={value} />
    case 'enum':    return <EnumBadge value={value} />
  }
}

interface FieldRowProps {
  unit: Unit
  value: unknown
}

function FieldRow({ unit, value }: FieldRowProps) {
  const widget = renderWidget(unit, value)
  if (!widget) return null
  const Icon = getIcon(unit.display?.icon)
  const label = unit.display?.label ?? unit.name

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {Icon && <Icon className="h-4 w-4" />}
        <span>{label}</span>
      </div>
      {widget}
    </div>
  )
}

export function GenericDeviceCard({ device, state }: GenericDeviceCardProps) {
  const unitsByField = Object.fromEntries(device.units.map(u => [u.output_field, u]))

  function renderGroups() {
    return (device.layout?.groups ?? []).map((group, i) => (
      <div key={i} className="space-y-2">
        {group.title && (
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.title}</p>
        )}
        {group.fields.map(field => {
          const unit = unitsByField[field]
          if (!unit) return null
          return <FieldRow key={field} unit={unit} value={state?.state[field]} />
        })}
      </div>
    ))
  }

  function renderFlat() {
    return [...device.units]
      .sort((a, b) => a.position - b.position)
      .map(unit => (
        <FieldRow key={unit.output_field} unit={unit} value={state?.state[unit.output_field]} />
      ))
  }

  return (
    <DeviceCard title={device.name} state={state}>
      <div className="space-y-3">
        {device.layout?.groups ? renderGroups() : renderFlat()}
      </div>
    </DeviceCard>
  )
}
