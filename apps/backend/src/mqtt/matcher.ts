export function mqttTopicMatches(pattern: string, topic: string): boolean {
  const pp = pattern.split('/')
  const tp = topic.split('/')

  for (let i = 0; i < pp.length; i++) {
    if (pp[i] === '#') return true
    if (tp[i] === undefined) return false
    if (pp[i] !== '+' && pp[i] !== tp[i]) return false
  }

  return pp.length === tp.length
}
