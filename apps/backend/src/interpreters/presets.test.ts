import { describe, it, expect } from 'vitest'
import { PRESETS, applyPreset, extractVars, findPreset } from './presets'

describe('PRESETS catalogue', () => {
  it('contient au moins les 6 presets attendus', () => {
    const keys = PRESETS.map(p => p.key).sort()
    expect(keys).toEqual([
      'frigate-camera',
      'raw-passthrough',
      'tasmota-dht',
      'tasmota-energy',
      'tasmota-power',
      'wled',
    ])
  })

  it('chaque preset a un nom, units non vides, placeholders définis', () => {
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.units.length).toBeGreaterThan(0)
      expect(Array.isArray(p.placeholders)).toBe(true)
    }
  })

  it('frigate-camera a debounce_ms 300', () => {
    const p = findPreset('frigate-camera')
    expect(p?.debounce_ms).toBe(300)
  })
})

describe('extractVars', () => {
  it('extrait { camera } de frigate/{camera}/events', () => {
    expect(extractVars('frigate/{camera}/events', 'frigate/principale/events')).toEqual({ camera: 'principale' })
  })

  it('extrait plusieurs placeholders', () => {
    expect(extractVars('{prefix}tele/{device_id}/STATE', 'home/abc/tele/chambre/STATE'))
      .toEqual({ prefix: 'home/abc/', device_id: 'chambre' })
  })

  it('retourne null si le pattern ne match pas', () => {
    expect(extractVars('frigate/{camera}/events', 'other/topic')).toBeNull()
  })

  it('extrait depuis un wildcard MQTT +', () => {
    expect(extractVars('frigate/{camera}/events', 'frigate/+/events')).toEqual({ camera: '+' })
  })

  it('prefix peut être vide', () => {
    expect(extractVars('{prefix}tele/{device_id}/STATE', 'tele/chambre/STATE'))
      .toEqual({ prefix: '', device_id: 'chambre' })
  })
})

describe('applyPreset', () => {
  it('substitue les placeholders dans tous les topic_patterns', () => {
    const preset = findPreset('frigate-camera')!
    const units = applyPreset(preset, { camera: 'chambre' })
    expect(units.every(u => !u.topic_pattern.includes('{'))).toBe(true)
    expect(units[0].topic_pattern).toContain('chambre')
  })

  it('ne modifie pas les autres champs', () => {
    const preset = findPreset('wled')!
    const units = applyPreset(preset, { device_id: 'salon' })
    expect(units[0].output_field).toBe(preset.units[0].output_field)
    expect(units[0].transform).toEqual(preset.units[0].transform)
  })
})

describe('findPreset', () => {
  it('retourne undefined si inconnu', () => {
    expect(findPreset('inconnu')).toBeUndefined()
  })
})
