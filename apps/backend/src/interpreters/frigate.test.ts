import { describe, it, expect } from 'vitest'
import { frigateInterpreter } from './frigate'

const toBuffer = (obj: unknown) => Buffer.from(JSON.stringify(obj))

describe('frigateInterpreter', () => {
  it('a les bons topics', () => {
    expect(frigateInterpreter.topics).toContain('frigate/+/events')
  })

  it('retourne null pour un topic inconnu', () => {
    const result = frigateInterpreter.parse('frigate/cam/unknown', toBuffer({}))
    expect(result).toBeNull()
  })

  it('parse un événement de début de détection (type: new)', () => {
    const payload = {
      type: 'new',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.92,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result).not.toBeNull()
    expect(result?.event_type).toBe('detection_start')
    expect(result?.state).toMatchObject({
      object: 'person',
      zone: 'chambre',
      confidence: 0.92,
      camera: 'chambre_cam',
      session_id: 'abc123',
    })
  })

  it('parse un événement de fin de détection (type: end)', () => {
    const payload = {
      type: 'end',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.85,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result?.event_type).toBe('detection_end')
  })

  it('ignore les événements de type update', () => {
    const payload = {
      type: 'update',
      after: {
        id: 'abc123',
        label: 'person',
        camera: 'chambre_cam',
        current_zones: ['chambre'],
        score: 0.88,
      },
    }
    const result = frigateInterpreter.parse('frigate/chambre_cam/events', toBuffer(payload))
    expect(result).toBeNull()
  })

  it('retourne null si le payload est invalide', () => {
    const result = frigateInterpreter.parse('frigate/cam/events', Buffer.from('invalid json{'))
    expect(result).toBeNull()
  })
})
