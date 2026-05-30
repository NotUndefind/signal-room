import type { DeviceState, Interpreter } from './types'

export const rawInterpreter: Interpreter = {
  source: 'raw',
  topics: [],
  parse(topic: string, payload: Buffer): DeviceState | null {
    const payloadStr = payload.toString()

    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(payloadStr)
    } catch {
      // Si ce n'est pas du JSON valide, on retourne la string brute
      parsedPayload = payloadStr
    }

    return {
      source: 'raw',
      event_type: 'raw_message',
      state: {
        topic,
        payload: parsedPayload
      },
      raw: payloadStr,
      timestamp: Date.now()
    }
  }
}
