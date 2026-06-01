import { describe, it, expect } from 'vitest'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'
import { createTasmotaInterpreter } from './tasmota'
import { createUnitRegistry } from './registry'
import { createAggregator } from './aggregator'
import { findPreset, applyPreset } from './presets'
import type { DeviceEntry } from './types'

function buildDevice(id: number, name: string, presetKey: string, vars: Record<string, string>, debounceMs: number | null = null): DeviceEntry {
  const preset = findPreset(presetKey)!
  const units = applyPreset(preset, vars).map((u, i) => ({ ...u, id: i + 1, device_id: id }))
  return { id, name, debounce_ms: debounceMs, layout: null, units, active: true, created_at: 0 }
}

describe('Parité Frigate detection_start (type=new)', () => {
  it('produit les mêmes champs que l\'ancien interpréteur', () => {
    const payload = JSON.stringify({
      type: 'new',
      after: { id: 'evt-1', label: 'person', camera: 'chambre', current_zones: ['bureau'], score: 0.876 },
    })
    const legacy = frigateInterpreter.parse('frigate/chambre/events', Buffer.from(payload))!

    const device = buildDevice(1, 'Frigate', 'frigate-camera', { camera: 'chambre' }, 300)
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('frigate/chambre/events', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.event_type).toBe(legacy.event_type)
    expect(state.state.object).toBe(legacy.state.object)
    expect(state.state.zone).toBe(legacy.state.zone)
    expect(state.state.confidence).toBe(legacy.state.confidence)
    expect(state.state.camera).toBe(legacy.state.camera)
    expect(state.state.active).toBe(legacy.state.active)
  })
})

describe('Parité Frigate detection_end (type=end)', () => {
  it('produit les mêmes champs', () => {
    const payload = JSON.stringify({
      type: 'end',
      after: { id: 'evt-1', label: 'person', camera: 'chambre', current_zones: ['bureau'], score: 0.91 },
    })
    const legacy = frigateInterpreter.parse('frigate/chambre/events', Buffer.from(payload))!

    const device = buildDevice(1, 'Frigate', 'frigate-camera', { camera: 'chambre' }, 300)
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('frigate/chambre/events', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.event_type).toBe('detection_end')
    expect(state.state.active).toBe(false)
  })
})

describe('Parité WLED', () => {
  it('on/off, brightness, color, fx, pal', () => {
    const payload = JSON.stringify({ on: true, bri: 128, seg: [{ col: [[255, 100, 0]], fx: 3, pal: 1 }] })
    const legacy = wledInterpreter.parse('wled/salon/v', Buffer.from(payload))!

    const device = buildDevice(2, 'WLED', 'wled', { device_id: 'salon' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('wled/salon/v', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.power).toBe(legacy.state.power)
    expect(state.state.brightness).toBe(legacy.state.brightness)
    expect((state.state.color as string).toLowerCase()).toBe((legacy.state.color as string).toLowerCase())
    expect(state.state.effect_id).toBe(legacy.state.effect_id)
    expect(state.state.palette_id).toBe(legacy.state.palette_id)
  })
})

describe('Parité Tasmota STATE (POWER)', () => {
  it('produit power=true et device_id', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({ POWER: 'ON', Wifi: { RSSI: 50 } })
    const legacy = tasmota.parse('tele/chambre/STATE', Buffer.from(payload))!

    const device = buildDevice(3, 'Tasmota', 'tasmota-power', { prefix: '', device_id: 'chambre' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/STATE', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.power).toBe(legacy.state.power)
    expect(state.state.rssi).toBe(legacy.state.rssi)
  })
})

describe('Parité Tasmota SENSOR (énergie)', () => {
  it('watt, voltage, kwh', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({
      ENERGY: { Power: 150, Voltage: 230, Current: 0.65, Today: 1.2, Total: 42.5 },
    })
    const legacy = tasmota.parse('tele/chambre/SENSOR', Buffer.from(payload))!

    const device = buildDevice(4, 'Tasmota Energy', 'tasmota-energy', { prefix: '', device_id: 'chambre' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/SENSOR', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.watt).toBe(legacy.state.watt)
    expect(state.state.voltage).toBe(legacy.state.voltage)
    expect(state.state.kwh_today).toBe(legacy.state.kwh_today)
    expect(state.state.kwh_total).toBe(legacy.state.kwh_total)
  })
})

describe('Parité Tasmota SENSOR (température/humidité)', () => {
  it('AM2301', () => {
    const tasmota = createTasmotaInterpreter('')
    const payload = JSON.stringify({ AM2301: { Temperature: 22.5, Humidity: 55 } })
    const legacy = tasmota.parse('tele/chambre/SENSOR', Buffer.from(payload))!

    const device = buildDevice(5, 'Tasmota DHT', 'tasmota-dht', { prefix: '', device_id: 'chambre', sensor: 'AM2301' })
    const reg = createUnitRegistry([device])
    const agg = createAggregator()
    const [res] = reg.route('tele/chambre/SENSOR', Buffer.from(payload))
    const state = agg.merge(res.device_id, res.partial_state, res.raw)

    expect(state.state.temperature).toBe(legacy.state.temperature)
    expect(state.state.humidity).toBe(legacy.state.humidity)
  })
})
