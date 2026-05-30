import { describe, it, expect } from 'vitest'
import { mqttTopicMatches } from './matcher'

describe('mqttTopicMatches', () => {
  it('match exact', () => {
    expect(mqttTopicMatches('home/sensor/temp', 'home/sensor/temp')).toBe(true)
  })

  it('ne matche pas si différent', () => {
    expect(mqttTopicMatches('home/sensor/temp', 'home/sensor/humidity')).toBe(false)
  })

  it('+ matche un segment', () => {
    expect(mqttTopicMatches('home/+/temp', 'home/sensor/temp')).toBe(true)
    expect(mqttTopicMatches('home/+/temp', 'home/other/temp')).toBe(true)
    expect(mqttTopicMatches('home/+/temp', 'home/sensor/humidity')).toBe(false)
  })

  it('+ ne matche pas plusieurs segments', () => {
    expect(mqttTopicMatches('home/+/temp', 'home/a/b/temp')).toBe(false)
  })

  it('# matche zéro ou plusieurs segments en fin', () => {
    expect(mqttTopicMatches('home/#', 'home/sensor')).toBe(true)
    expect(mqttTopicMatches('home/#', 'home/sensor/temp')).toBe(true)
    expect(mqttTopicMatches('home/#', 'home')).toBe(true)
  })

  it('# seul matche tout', () => {
    expect(mqttTopicMatches('#', 'anything/at/all')).toBe(true)
  })

  it('longueurs différentes sans wildcard', () => {
    expect(mqttTopicMatches('a/b', 'a/b/c')).toBe(false)
    expect(mqttTopicMatches('a/b/c', 'a/b')).toBe(false)
  })
})
