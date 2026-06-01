import { describe, it, expect } from 'vitest'
import { buildTopicsTree, filterTree, type TreeNode } from './topics-tree'
import type { TopicSeen } from './registry-api'

function topic(t: string, overrides: Partial<TopicSeen> = {}): TopicSeen {
  return {
    topic: t,
    first_seen: 1_000,
    last_seen: 2_000,
    message_count: 1,
    detected_type: null,
    ...overrides,
  }
}

describe('buildTopicsTree', () => {
  it('retourne [] pour une liste vide', () => {
    expect(buildTopicsTree([], [])).toEqual([])
  })

  it('crée une feuille racine pour un topic mono-segment', () => {
    const tree = buildTopicsTree([topic('wled')], [])
    expect(tree).toHaveLength(1)
    expect(tree[0].segment).toBe('wled')
    expect(tree[0].path).toBe('wled')
    expect(tree[0].isLeaf).toBe(true)
    expect(tree[0].children).toEqual([])
    expect(tree[0].topic?.topic).toBe('wled')
  })

  it('construit une arborescence profonde', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/enabled/state')], [])
    expect(tree).toHaveLength(1)
    const frigate = tree[0]
    expect(frigate.segment).toBe('frigate')
    expect(frigate.isLeaf).toBe(false)
    expect(frigate.children).toHaveLength(1)

    const chambre = frigate.children[0]
    expect(chambre.segment).toBe('chambre')
    expect(chambre.path).toBe('frigate/chambre')

    const enabled = chambre.children[0]
    const state = enabled.children[0]
    expect(state.segment).toBe('state')
    expect(state.path).toBe('frigate/chambre/enabled/state')
    expect(state.isLeaf).toBe(true)
    expect(state.topic).toBeDefined()
  })

  it('fusionne les topics partageant un préfixe', () => {
    const tree = buildTopicsTree(
      [topic('frigate/a/x'), topic('frigate/a/y'), topic('frigate/b/z')],
      [],
    )
    expect(tree).toHaveLength(1)
    const frigate = tree[0]
    expect(frigate.children).toHaveLength(2)
    const [a, b] = frigate.children
    expect(a.segment).toBe('a')
    expect(b.segment).toBe('b')
    expect(a.children.map(c => c.segment)).toEqual(['x', 'y'])
    expect(b.children.map(c => c.segment)).toEqual(['z'])
  })

  it('trie chaque niveau alphabétiquement, dossiers avant feuilles', () => {
    const tree = buildTopicsTree(
      [topic('z/leaf'), topic('a/leaf'), topic('m')],
      [],
    )
    expect(tree.map(n => n.segment)).toEqual(['a', 'z', 'm'])
  })

  it('ne duplique pas un topic inséré deux fois', () => {
    const tree = buildTopicsTree([topic('a/b'), topic('a/b')], [])
    expect(tree[0].children).toHaveLength(1)
  })

  describe('configured / allConfigured', () => {
    it('feuille avec pattern exact → configured=true, allConfigured=true', () => {
      const tree = buildTopicsTree([topic('home/sensor')], ['home/sensor'])
      expect(tree[0].configured).toBe(true)
      expect(tree[0].allConfigured).toBe(true)
    })

    it('feuille avec pattern wildcard +', () => {
      const tree = buildTopicsTree(
        [topic('frigate/principale/events')],
        ['frigate/+/events'],
      )
      const leaf = tree[0].children[0].children[0]
      expect(leaf.configured).toBe(true)
      expect(leaf.allConfigured).toBe(true)
    })

    it('feuille avec pattern wildcard #', () => {
      const tree = buildTopicsTree([topic('home/a/b/c')], ['home/#'])
      const leaf = walkTo(tree, ['home', 'a', 'b', 'c'])
      expect(leaf.configured).toBe(true)
    })

    it('dossier avec au moins une feuille configurée → configured=true, allConfigured=false', () => {
      const tree = buildTopicsTree(
        [topic('home/a'), topic('home/b')],
        ['home/a'],
      )
      const home = tree[0]
      expect(home.configured).toBe(true)
      expect(home.allConfigured).toBe(false)
    })

    it('dossier dont toutes les feuilles sont configurées → allConfigured=true', () => {
      const tree = buildTopicsTree(
        [topic('home/a'), topic('home/b')],
        ['home/a', 'home/b'],
      )
      const home = tree[0]
      expect(home.configured).toBe(true)
      expect(home.allConfigured).toBe(true)
    })

    it('dossier sans aucune feuille configurée → configured=false', () => {
      const tree = buildTopicsTree(
        [topic('home/a'), topic('home/b')],
        ['other/pattern'],
      )
      const home = tree[0]
      expect(home.configured).toBe(false)
      expect(home.allConfigured).toBe(false)
    })
  })
})

function walkTo(tree: TreeNode[], segments: string[]): TreeNode {
  const first = tree.find(n => n.segment === segments[0])
  if (!first) throw new Error(`segment introuvable: ${segments[0]}`)
  let current: TreeNode = first
  for (let i = 1; i < segments.length; i++) {
    const next: TreeNode | undefined = current.children.find(n => n.segment === segments[i])
    if (!next) throw new Error(`segment introuvable: ${segments[i]}`)
    current = next
  }
  return current
}

describe('filterTree', () => {
  it('query vide → arbre identique, expandedPaths vide', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/state')], [])
    const { filtered, expandedPaths } = filterTree(tree, '')
    expect(filtered).toEqual(tree)
    expect(expandedPaths.size).toBe(0)
  })

  it('query qui matche une feuille → branches non-matchantes coupées', () => {
    const tree = buildTopicsTree(
      [topic('frigate/chambre/state'), topic('home/lumiere/power')],
      [],
    )
    const { filtered } = filterTree(tree, 'chambre')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].segment).toBe('frigate')
    expect(filtered[0].children).toHaveLength(1)
    expect(filtered[0].children[0].segment).toBe('chambre')
  })

  it('expandedPaths contient tous les ancêtres des feuilles matchantes', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/enabled/state')], [])
    const { expandedPaths } = filterTree(tree, 'state')
    expect(expandedPaths.has('frigate')).toBe(true)
    expect(expandedPaths.has('frigate/chambre')).toBe(true)
    expect(expandedPaths.has('frigate/chambre/enabled')).toBe(true)
    expect(expandedPaths.has('frigate/chambre/enabled/state')).toBe(false)
  })

  it('match case-insensitive', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/state')], [])
    const { filtered } = filterTree(tree, 'CHAM')
    expect(filtered).toHaveLength(1)
  })

  it('query sans match → filtered vide', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/state')], [])
    const { filtered, expandedPaths } = filterTree(tree, 'zzz')
    expect(filtered).toEqual([])
    expect(expandedPaths.size).toBe(0)
  })

  it('match sur le path complet, pas seulement le segment final', () => {
    const tree = buildTopicsTree([topic('frigate/chambre/state')], [])
    const { filtered } = filterTree(tree, 'frigate/cha')
    expect(filtered).toHaveLength(1)
  })
})
