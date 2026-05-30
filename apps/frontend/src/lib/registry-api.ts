const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001'

export interface RegistryDevice {
  id: number
  name: string
  topic_patterns: string[]
  interpreter_type: 'frigate' | 'tasmota' | 'wled' | 'raw'
  active: number
  created_at: number
}

export interface TopicSeen {
  topic: string
  first_seen: number
  last_seen: number
  message_count: number
  detected_type: string | null
}

export async function fetchRegistry(): Promise<RegistryDevice[]> {
  const res = await fetch(`${API_URL}/api/registry`)
  const data = await res.json() as { devices: RegistryDevice[] }
  return data.devices
}

export async function fetchTopicsSeen(sinceSeconds?: number): Promise<TopicSeen[]> {
  const url = sinceSeconds
    ? `${API_URL}/api/topics?since=${sinceSeconds}`
    : `${API_URL}/api/topics`
  const res = await fetch(url)
  const data = await res.json() as { topics: TopicSeen[] }
  return data.topics
}

export async function addDevice(device: {
  name: string
  topic_patterns: string[]
  interpreter_type: string
}): Promise<number> {
  const res = await fetch(`${API_URL}/api/registry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(device),
  })
  const data = await res.json() as { id: number }
  return data.id
}

export async function removeDevice(id: number): Promise<void> {
  await fetch(`${API_URL}/api/registry/${id}`, { method: 'DELETE' })
}
