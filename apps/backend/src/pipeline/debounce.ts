export type DebounceFn = (key: string, fn: () => void) => void

export function createDebounce(ms: number): DebounceFn {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  return function debounce(key: string, fn: () => void): void {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)

    timers.set(key, setTimeout(() => {
      timers.delete(key)
      fn()
    }, ms))
  }
}
