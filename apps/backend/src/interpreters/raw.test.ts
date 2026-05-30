import { describe, it, expect } from 'vitest'
import { rawInterpreter } from './raw'

describe('rawInterpreter', () => {
  it('retourne le payload JSON parsé dans state.payload', () => {
    const payload = Buffer.from(JSON.stringify({ temperature: 22.5 }))
    const result = rawInterpreter.parse('home/sensor/temp', payload)
    expect(result).not.toBeNull()
    expect(result?.source).toBe('raw')
    expect(result?.event_type).toBe('raw_message')
    expect(result?.state.payload).toEqual({ temperature: 22.5 })
    expect(result?.state.topic).toBe('home/sensor/temp')
  })

  it('retourne la string brute si le payload n\'est pas du JSON valide', () => {
    const payload = Buffer.from('not json')
    const result = rawInterpreter.parse('any/topic', payload)
    expect(result?.state.payload).toBe('not json')
  })

  it('accepte n\'importe quel topic', () => {
    const result = rawInterpreter.parse('completely/random/topic', Buffer.from('{}'))
    expect(result).not.toBeNull()
  })
})
