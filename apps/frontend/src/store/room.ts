import { create } from 'zustand'

export interface FrontendDeviceState {
  source: string
  event_type: string
  state: Record<string, unknown>
  timestamp: number
}

interface RoomStore {
  devices: Record<string, FrontendDeviceState>
  connected: boolean
  setDevice: (source: string, state: FrontendDeviceState) => void
  setDevices: (devices: Record<string, FrontendDeviceState>) => void
  setConnected: (connected: boolean) => void
}

export const useRoomStore = create<RoomStore>((set) => ({
  devices: {},
  connected: false,

  setDevice: (source, state) =>
    set((prev) => ({ devices: { ...prev.devices, [source]: state } })),

  setDevices: (devices) => set({ devices }),

  setConnected: (connected) => set({ connected }),
}))
