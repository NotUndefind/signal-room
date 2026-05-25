import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createDebounce } from './debounce'

describe('createDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('appelle la fonction après le délai', () => {
    const debounce = createDebounce(300)
    const fn = vi.fn()
    debounce('frigate', fn)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('réinitialise le timer si un second appel arrive avant le délai', () => {
    const debounce = createDebounce(300)
    const fn = vi.fn()
    debounce('frigate', fn)
    vi.advanceTimersByTime(200)
    debounce('frigate', fn)
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('gère des clés différentes indépendamment', () => {
    const debounce = createDebounce(300)
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    debounce('frigate', fn1)
    debounce('wled', fn2)
    vi.advanceTimersByTime(300)
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })
})
