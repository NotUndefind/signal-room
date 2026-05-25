import { describe, it, expect } from 'vitest'
import { createInterpreterRegistry } from './index'
import { frigateInterpreter } from './frigate'
import { wledInterpreter } from './wled'

describe('InterpreterRegistry', () => {
  it('collecte tous les topics des interpréteurs enregistrés', () => {
    const registry = createInterpreterRegistry([frigateInterpreter, wledInterpreter])
    const topics = registry.getAllTopics()
    expect(topics).toContain('frigate/+/events')
    expect(topics).toContain('wled/+/v')
  })

  it('route un message vers le bon interpréteur', () => {
    const registry = createInterpreterRegistry([frigateInterpreter, wledInterpreter])
    const payload = Buffer.from(JSON.stringify({ on: true, bri: 255, seg: [{ col: [[255, 0, 0]], fx: 0, pal: 0 }] }))
    const result = registry.route('wled/chambre/v', payload)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('wled')
  })

  it('retourne null si aucun interpréteur ne correspond', () => {
    const registry = createInterpreterRegistry([frigateInterpreter])
    const result = registry.route('zigbee/device/state', Buffer.from('{}'))
    expect(result).toBeNull()
  })

  it('expose le debounceMs de l\'interpréteur correspondant', () => {
    const registry = createInterpreterRegistry([frigateInterpreter])
    const debounce = registry.getDebounceMs('frigate')
    expect(debounce).toBe(300)
  })

  it('retourne undefined si pas de debounce configuré', () => {
    const registry = createInterpreterRegistry([wledInterpreter])
    const debounce = registry.getDebounceMs('wled')
    expect(debounce).toBeUndefined()
  })
})
