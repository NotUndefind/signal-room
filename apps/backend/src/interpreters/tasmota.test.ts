import { describe, it, expect } from 'vitest'
import { tasmotaInterpreter } from './tasmota'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('tasmotaInterpreter', () => {
  it('a les bons topics', () => {
    expect(tasmotaInterpreter.topics).toContain('tele/+/STATE')
    expect(tasmotaInterpreter.topics).toContain('tele/+/SENSOR')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = tasmotaInterpreter.parse('stat/device/SOMETHING', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un STATE (interrupteur/prise)', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      POWER: 'ON',
      Wifi: { RSSI: 72 },
    }
    const result = tasmotaInterpreter.parse('tele/prise_bureau/STATE', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('state_change')
    expect(result?.state).toMatchObject({
      power: true,
      device_id: 'prise_bureau',
    })
  })

  it('parse un SENSOR avec énergie', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      ENERGY: {
        Power: 45,
        Voltage: 230,
        Current: 0.196,
        Today: 0.123,
        Total: 1.234,
      },
    }
    const result = tasmotaInterpreter.parse('tele/prise_bureau/SENSOR', toBuffer(payload))
    expect(result?.event_type).toBe('sensor_update')
    expect(result?.state).toMatchObject({
      watt: 45,
      voltage: 230,
      kwh_today: 0.123,
      kwh_total: 1.234,
      device_id: 'prise_bureau',
    })
  })

  it('parse un SENSOR avec température/humidité', () => {
    const payload = {
      Time: '2024-01-01T12:00:00',
      AM2301: { Temperature: 21.5, Humidity: 58.0 },
    }
    const result = tasmotaInterpreter.parse('tele/capteur/SENSOR', toBuffer(payload))
    expect(result?.state).toMatchObject({
      temperature: 21.5,
      humidity: 58.0,
    })
  })

  it('retourne null si le payload est invalide', () => {
    const result = tasmotaInterpreter.parse('tele/device/STATE', Buffer.from('bad json'))
    expect(result).toBeNull()
  })
})
