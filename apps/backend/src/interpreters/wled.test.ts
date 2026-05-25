import { describe, it, expect } from 'vitest'
import { wledInterpreter } from './wled'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('wledInterpreter', () => {
  it('a les bons topics', () => {
    expect(wledInterpreter.topics).toContain('wled/+/v')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = wledInterpreter.parse('wled/chambre/unknown', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un état allumé avec couleur et effet', () => {
    const payload = {
      on: true,
      bri: 204,
      seg: [
        {
          col: [[255, 68, 0]],
          fx: 65,
          pal: 0,
        },
      ],
    }
    const result = wledInterpreter.parse('wled/chambre/v', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('state_change')
    expect(result?.state).toMatchObject({
      power: true,
      brightness: 80,
      color: '#ff4400',
    })
    expect(result?.state.effect_id).toBe(65)
  })

  it('parse un état éteint', () => {
    const payload = { on: false, bri: 0, seg: [{ col: [[0, 0, 0]], fx: 0, pal: 0 }] }
    const result = wledInterpreter.parse('wled/chambre/v', toBuffer(payload))
    expect(result?.state.power).toBe(false)
    expect(result?.state.brightness).toBe(0)
  })

  it('retourne null si le payload est invalide', () => {
    const result = wledInterpreter.parse('wled/chambre/v', Buffer.from('not json'))
    expect(result).toBeNull()
  })
})
