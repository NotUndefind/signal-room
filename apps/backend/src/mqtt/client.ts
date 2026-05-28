import { connect } from 'mqtt'
import type { MqttClient } from 'mqtt'

interface MqttClientOptions {
  host: string
  port: number
  username?: string
  password?: string
  topics: string[]
  onMessage: (topic: string, payload: Buffer) => void
}

export function createMqttClient(options: MqttClientOptions): MqttClient {
  const client = connect(`mqtt://${options.host}:${options.port}`, {
    username: options.username,
    password: options.password,
  })

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${options.host}:${options.port}`)
    client.subscribe(options.topics, { qos: 1 }, (err) => {
      if (err) console.error('[MQTT] Subscribe error:', err)
      else console.log(`[MQTT] Subscribed to ${options.topics.length} topics`)
    })
  })

  client.on('message', (topic, payload) => {
    console.log(`[MQTT] Message reçu — topic: ${topic} | payload: ${payload.toString().slice(0, 120)}`)
    options.onMessage(topic, payload)
  })

  client.on('error', (err) => {
    console.error('[MQTT] Error:', err)
  })

  client.on('disconnect', () => {
    console.warn('[MQTT] Disconnected')
  })

  return client
}
