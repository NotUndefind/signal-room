const API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL ?? 'http://localhost:3001'

export interface StoredEvent {
  id: number
  source: string
  topic: string
  event_type: string
  payload: string
  raw: string
  created_at: number
}

export interface EventsResponse {
  data: StoredEvent[]
  total: number
}

export async function fetchEvents(params: {
  source?: string
  event_type?: string
  from?: number
  to?: number
  page: number
  limit: number
}): Promise<EventsResponse> {
  const url = new URL(`${API_URL}/api/events`)
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined) url.searchParams.set(key, String(val))
  })

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<EventsResponse>
}
