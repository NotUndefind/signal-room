import type { TopicSeen } from './registry-api'
import { mqttTopicMatches } from './mqtt-matcher'

export interface TreeNode {
  segment: string
  path: string
  children: TreeNode[]
  isLeaf: boolean
  topic?: TopicSeen
  configured: boolean
  allConfigured: boolean
}

interface MutableNode {
  segment: string
  path: string
  childrenMap: Map<string, MutableNode>
  topic?: TopicSeen
  isLeaf: boolean
}

function makeMutableNode(segment: string, path: string): MutableNode {
  return { segment, path, childrenMap: new Map(), isLeaf: false }
}

export function buildTopicsTree(
  topics: TopicSeen[],
  registeredPatterns: string[],
): TreeNode[] {
  const roots = new Map<string, MutableNode>()

  for (const t of topics) {
    const segments = t.topic.split('/')
    let levelMap = roots
    let cumulativePath = ''

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      cumulativePath = cumulativePath ? `${cumulativePath}/${seg}` : seg
      let node = levelMap.get(seg)
      if (!node) {
        node = makeMutableNode(seg, cumulativePath)
        levelMap.set(seg, node)
      }
      if (i === segments.length - 1) {
        node.isLeaf = true
        node.topic = t
      }
      levelMap = node.childrenMap
    }
  }

  return Array.from(roots.values())
    .map(n => finalize(n, registeredPatterns))
    .sort(compareNodes)
}

function finalize(node: MutableNode, patterns: string[]): TreeNode {
  const children = Array.from(node.childrenMap.values())
    .map(c => finalize(c, patterns))
    .sort(compareNodes)

  if (children.length === 0) {
    const configured = patterns.some(p => mqttTopicMatches(p, node.path))
    return {
      segment: node.segment,
      path: node.path,
      children: [],
      isLeaf: true,
      topic: node.topic,
      configured,
      allConfigured: configured,
    }
  }

  const configured = children.some(c => c.configured)
  const allConfigured = children.every(c => c.allConfigured)

  return {
    segment: node.segment,
    path: node.path,
    children,
    isLeaf: false,
    topic: node.topic,
    configured,
    allConfigured,
  }
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1
  return a.segment.localeCompare(b.segment)
}
