# Topics Tree — Refonte découverte MQTT — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Retirer la liste plate des topics non-configurés du dashboard et la remplacer par une arborescence navigable dans `/devices`, avec recherche, marquage des topics configurés et pré-remplissage du formulaire d'ajout.

**Architecture :** Aucun changement backend. Côté frontend, transformation pure `flat → arbre` en mémoire à partir de `fetchTopicsSeen()` + `fetchRegistry()`. Composant `TopicsTree` maison récursif avec collapse local et auto-expand sur recherche. Intégration dans `/devices/page.tsx` en grille 3 colonnes.

**Tech Stack :** Next.js App Router (custom), React 19, TypeScript, Tailwind v4, shadcn/ui, lucide-react, Vitest, @testing-library/react.

**Spec :** [`docs/superpowers/specs/2026-05-31-topics-tree-design.md`](../specs/2026-05-31-topics-tree-design.md)

---

## File Structure

### Frontend — nouveaux fichiers

- `apps/frontend/src/lib/mqtt-matcher.ts` — copie verbatim du matcher backend
- `apps/frontend/src/lib/mqtt-matcher.test.ts` — copie verbatim de la suite backend
- `apps/frontend/src/lib/topics-tree.ts` — types `TreeNode` + `buildTopicsTree` + `filterTree`
- `apps/frontend/src/lib/topics-tree.test.ts`
- `apps/frontend/src/components/devices/TopicNode.tsx` — node récursif (dossier ou feuille)
- `apps/frontend/src/components/devices/TopicsTree.tsx` — racine (recherche + render)
- `apps/frontend/src/components/devices/TopicsTree.test.tsx`

### Frontend — fichiers modifiés

- `apps/frontend/src/app/page.tsx` — retirer toute l'UI des topics non-configurés
- `apps/frontend/src/app/devices/page.tsx` — passer en 3 colonnes, intégrer `TopicsTree`, bouton refresh, focus du champ Nom après prefill, supprimer le `<datalist>`

### Frontend — fichiers supprimés

- `apps/frontend/src/components/devices/DiscoveredCard.tsx`

---

## Task 1 : MQTT matcher côté frontend

**Files :**
- Create : `apps/frontend/src/lib/mqtt-matcher.ts`
- Create : `apps/frontend/src/lib/mqtt-matcher.test.ts`

- [ ] **Step 1 : Écrire la suite de tests (copie verbatim du backend)**

Créer `apps/frontend/src/lib/mqtt-matcher.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { mqttTopicMatches } from './mqtt-matcher'

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
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/frontend && npx vitest run src/lib/mqtt-matcher.test.ts
```

Expected : FAIL avec `Cannot find module './mqtt-matcher'`.

- [ ] **Step 3 : Implémenter le matcher**

Créer `apps/frontend/src/lib/mqtt-matcher.ts` :

```typescript
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
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/frontend && npx vitest run src/lib/mqtt-matcher.test.ts
```

Expected : PASS (7 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/frontend/src/lib/mqtt-matcher.ts apps/frontend/src/lib/mqtt-matcher.test.ts
git commit -m "feat(frontend): add MQTT topic matcher (mirror of backend)"
```

---

## Task 2 : Types `TreeNode` et fonction `buildTopicsTree`

**Files :**
- Create : `apps/frontend/src/lib/topics-tree.ts`
- Create : `apps/frontend/src/lib/topics-tree.test.ts`

- [ ] **Step 1 : Écrire les tests de `buildTopicsTree`**

Créer `apps/frontend/src/lib/topics-tree.test.ts` :

```typescript
import { describe, it, expect } from 'vitest'
import { buildTopicsTree, type TreeNode } from './topics-tree'
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
  let current = tree.find(n => n.segment === segments[0])
  if (!current) throw new Error(`segment introuvable: ${segments[0]}`)
  for (let i = 1; i < segments.length; i++) {
    const next = current.children.find(n => n.segment === segments[i])
    if (!next) throw new Error(`segment introuvable: ${segments[i]}`)
    current = next
  }
  return current
}
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/frontend && npx vitest run src/lib/topics-tree.test.ts
```

Expected : FAIL avec `Cannot find module './topics-tree'`.

- [ ] **Step 3 : Implémenter `topics-tree.ts` (sans `filterTree` pour l'instant)**

Créer `apps/frontend/src/lib/topics-tree.ts` :

```typescript
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

  return Array.from(roots.values()).map(n => finalize(n, registeredPatterns))
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
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/frontend && npx vitest run src/lib/topics-tree.test.ts
```

Expected : PASS (toute la suite `buildTopicsTree`).

- [ ] **Step 5 : Commit**

```bash
git add apps/frontend/src/lib/topics-tree.ts apps/frontend/src/lib/topics-tree.test.ts
git commit -m "feat(frontend): add buildTopicsTree pure transformation"
```

---

## Task 3 : Fonction `filterTree`

**Files :**
- Modify : `apps/frontend/src/lib/topics-tree.ts`
- Modify : `apps/frontend/src/lib/topics-tree.test.ts`

- [ ] **Step 1 : Ajouter les tests de `filterTree`**

Ajouter à la fin de `apps/frontend/src/lib/topics-tree.test.ts` :

```typescript
import { filterTree } from './topics-tree'

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
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/frontend && npx vitest run src/lib/topics-tree.test.ts
```

Expected : FAIL avec `filterTree` non exporté.

- [ ] **Step 3 : Implémenter `filterTree`**

Ajouter à la fin de `apps/frontend/src/lib/topics-tree.ts` :

```typescript
export interface FilterResult {
  filtered: TreeNode[]
  expandedPaths: Set<string>
}

export function filterTree(tree: TreeNode[], query: string): FilterResult {
  if (query === '') {
    return { filtered: tree, expandedPaths: new Set() }
  }

  const q = query.toLowerCase()
  const expandedPaths = new Set<string>()

  function visit(node: TreeNode): TreeNode | null {
    if (node.isLeaf) {
      return node.path.toLowerCase().includes(q) ? node : null
    }

    const keptChildren: TreeNode[] = []
    for (const child of node.children) {
      const kept = visit(child)
      if (kept) keptChildren.push(kept)
    }

    if (keptChildren.length === 0) return null

    expandedPaths.add(node.path)

    return {
      ...node,
      children: keptChildren,
    }
  }

  const filtered: TreeNode[] = []
  for (const root of tree) {
    const kept = visit(root)
    if (kept) filtered.push(kept)
  }

  return { filtered, expandedPaths }
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/frontend && npx vitest run src/lib/topics-tree.test.ts
```

Expected : PASS (`buildTopicsTree` + `filterTree`).

- [ ] **Step 5 : Commit**

```bash
git add apps/frontend/src/lib/topics-tree.ts apps/frontend/src/lib/topics-tree.test.ts
git commit -m "feat(frontend): add filterTree for search filtering"
```

---

## Task 4 : Composant `TopicNode`

**Files :**
- Create : `apps/frontend/src/components/devices/TopicNode.tsx`

Pas de test unitaire isolé — couvert via les tests de `TopicsTree` (Task 5). `TopicNode` est un détail d'implémentation interne.

- [ ] **Step 1 : Créer `TopicNode.tsx`**

Créer `apps/frontend/src/components/devices/TopicNode.tsx` :

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { TreeNode } from '@/lib/topics-tree'

interface TopicNodeProps {
  node: TreeNode
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelectTopic: (topic: string) => void
}

export function TopicNode({ node, depth, expandedPaths, onToggle, onSelectTopic }: TopicNodeProps) {
  const paddingLeft = depth * 16

  if (node.isLeaf) {
    return <LeafRow node={node} paddingLeft={paddingLeft} onSelectTopic={onSelectTopic} />
  }

  const isExpanded = expandedPaths.has(node.path)

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex items-center w-full gap-1 py-1 text-sm font-mono hover:bg-muted rounded"
        style={{ paddingLeft }}
        aria-expanded={isExpanded}
      >
        {isExpanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{node.segment}/</span>
        <FolderBadge node={node} />
      </button>
      {isExpanded && (
        <div>
          {node.children.map(child => (
            <TopicNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelectTopic={onSelectTopic}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FolderBadge({ node }: { node: TreeNode }) {
  if (node.allConfigured) {
    return <Badge variant="secondary" className="ml-auto opacity-70 text-[10px]">configuré</Badge>
  }
  if (node.configured) {
    return <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary opacity-70" aria-label="contient des topics nouveaux" />
  }
  return <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="nouveau" />
}

function LeafRow({
  node,
  paddingLeft,
  onSelectTopic,
}: {
  node: TreeNode
  paddingLeft: number
  onSelectTopic: (topic: string) => void
}) {
  const title = buildTooltip(node)

  if (node.configured) {
    return (
      <div
        className="flex items-center w-full gap-1 py-1 text-sm font-mono opacity-70 cursor-default"
        style={{ paddingLeft: paddingLeft + 16 }}
        title={title}
      >
        <span className="truncate">{node.segment}</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">configuré</Badge>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onSelectTopic(node.path)}
      className="flex items-center w-full gap-1 py-1 text-sm font-mono hover:bg-muted rounded focus:outline-none focus:ring-2 focus:ring-ring"
      style={{ paddingLeft: paddingLeft + 16 }}
      title={title}
    >
      <span className="truncate">{node.segment}</span>
      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="nouveau" />
    </button>
  )
}

function buildTooltip(node: TreeNode): string {
  if (!node.topic) return ''
  const lastSeen = new Date(node.topic.last_seen).toLocaleTimeString('fr-FR')
  const parts = [
    `Dernière vue : ${lastSeen}`,
    `${node.topic.message_count} message${node.topic.message_count > 1 ? 's' : ''}`,
  ]
  if (node.topic.detected_type) parts.push(`type : ${node.topic.detected_type}`)
  return parts.join(' · ')
}
```

- [ ] **Step 2 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 3 : Commit**

```bash
git add apps/frontend/src/components/devices/TopicNode.tsx
git commit -m "feat(frontend): add TopicNode recursive component"
```

---

## Task 5 : Composant `TopicsTree`

**Files :**
- Create : `apps/frontend/src/components/devices/TopicsTree.tsx`
- Create : `apps/frontend/src/components/devices/TopicsTree.test.tsx`

- [ ] **Step 1 : Écrire les tests**

Créer `apps/frontend/src/components/devices/TopicsTree.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopicsTree } from './TopicsTree'
import type { TopicSeen } from '@/lib/registry-api'

function topic(t: string): TopicSeen {
  return { topic: t, first_seen: 1, last_seen: 2, message_count: 5, detected_type: null }
}

describe('TopicsTree', () => {
  it('affiche un message si aucun topic', () => {
    render(<TopicsTree topics={[]} registeredPatterns={[]} onSelectTopic={() => {}} />)
    expect(screen.getByText(/aucun topic découvert/i)).toBeInTheDocument()
  })

  it('rend les dossiers racine collapsés par défaut', () => {
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state'), topic('home/lumiere/power')]}
        registeredPatterns={[]}
        onSelectTopic={() => {}}
      />,
    )
    expect(screen.getByText('frigate/')).toBeInTheDocument()
    expect(screen.getByText('home/')).toBeInTheDocument()
    expect(screen.queryByText('chambre/')).not.toBeInTheDocument()
  })

  it('expand un dossier au clic, puis collapse au second clic', async () => {
    const user = userEvent.setup()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={[]}
        onSelectTopic={() => {}}
      />,
    )

    await user.click(screen.getByText('frigate/'))
    expect(screen.getByText('chambre/')).toBeInTheDocument()

    await user.click(screen.getByText('frigate/'))
    expect(screen.queryByText('chambre/')).not.toBeInTheDocument()
  })

  it('auto-expand les branches qui matchent la recherche', async () => {
    const user = userEvent.setup()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state'), topic('home/lumiere/power')]}
        registeredPatterns={[]}
        onSelectTopic={() => {}}
      />,
    )

    const input = screen.getByPlaceholderText(/rechercher/i)
    await user.type(input, 'state')

    await waitFor(() => expect(screen.getByText('state')).toBeInTheDocument())
    expect(screen.queryByText('home/')).not.toBeInTheDocument()
  })

  it('clic sur une feuille non-configurée appelle onSelectTopic avec le path complet', async () => {
    const user = userEvent.setup()
    const onSelectTopic = vi.fn()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={[]}
        onSelectTopic={onSelectTopic}
      />,
    )

    await user.click(screen.getByText('frigate/'))
    await user.click(screen.getByText('chambre/'))
    await user.click(screen.getByText('state'))

    expect(onSelectTopic).toHaveBeenCalledWith('frigate/chambre/state')
  })

  it('clic sur une feuille configurée n\'appelle PAS onSelectTopic', async () => {
    const user = userEvent.setup()
    const onSelectTopic = vi.fn()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={['frigate/chambre/state']}
        onSelectTopic={onSelectTopic}
      />,
    )

    await user.click(screen.getByText('frigate/'))
    await user.click(screen.getByText('chambre/'))
    await user.click(screen.getByText('state'))

    expect(onSelectTopic).not.toHaveBeenCalled()
  })

  it('marque une feuille configurée avec un badge', async () => {
    const user = userEvent.setup()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={['frigate/chambre/state']}
        onSelectTopic={() => {}}
      />,
    )
    await user.click(screen.getByText('frigate/'))
    await user.click(screen.getByText('chambre/'))
    const badges = screen.getAllByText('configuré')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('feuille a un tooltip natif avec message_count', async () => {
    const user = userEvent.setup()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={[]}
        onSelectTopic={() => {}}
      />,
    )
    await user.click(screen.getByText('frigate/'))
    await user.click(screen.getByText('chambre/'))
    const leaf = screen.getByText('state').closest('button, div')
    expect(leaf?.getAttribute('title')).toMatch(/message/)
  })

  it('recherche sans match → message dédié', async () => {
    const user = userEvent.setup()
    render(
      <TopicsTree
        topics={[topic('frigate/chambre/state')]}
        registeredPatterns={[]}
        onSelectTopic={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText(/rechercher/i)
    await user.type(input, 'zzz')
    await waitFor(() => expect(screen.getByText(/ne correspond/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2 : Lancer les tests — vérifier qu'ils échouent**

```bash
cd apps/frontend && npx vitest run src/components/devices/TopicsTree.test.tsx
```

Expected : FAIL avec `Cannot find module './TopicsTree'`.

- [ ] **Step 3 : Implémenter `TopicsTree.tsx`**

Créer `apps/frontend/src/components/devices/TopicsTree.tsx` :

```tsx
'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { TopicSeen } from '@/lib/registry-api'
import { buildTopicsTree, filterTree } from '@/lib/topics-tree'
import { TopicNode } from './TopicNode'

interface TopicsTreeProps {
  topics: TopicSeen[]
  registeredPatterns: string[]
  onSelectTopic: (topic: string) => void
}

export function TopicsTree({ topics, registeredPatterns, onSelectTopic }: TopicsTreeProps) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set())

  const tree = useMemo(
    () => buildTopicsTree(topics, registeredPatterns),
    [topics, registeredPatterns],
  )

  const { filtered, expandedPaths: autoExpanded } = useMemo(
    () => filterTree(tree, deferredSearch),
    [tree, deferredSearch],
  )

  const effectiveExpanded = useMemo(() => {
    const set = new Set<string>()
    manuallyExpanded.forEach(p => set.add(p))
    autoExpanded.forEach(p => set.add(p))
    return set
  }, [manuallyExpanded, autoExpanded])

  function handleToggle(path: string) {
    setManuallyExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  if (topics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aucun topic découvert pour le moment. Vérifiez la connexion MQTT.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un topic…"
          className="w-full border rounded pl-8 pr-3 py-2 text-sm bg-background"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun topic ne correspond à <span className="font-mono">{search}</span>.
        </p>
      ) : (
        <div className="space-y-0.5">
          {filtered.map(node => (
            <TopicNode
              key={node.path}
              node={node}
              depth={0}
              expandedPaths={effectiveExpanded}
              onToggle={handleToggle}
              onSelectTopic={onSelectTopic}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4 : Lancer les tests — vérifier qu'ils passent**

```bash
cd apps/frontend && npx vitest run src/components/devices/TopicsTree.test.tsx
```

Expected : PASS (9 tests).

- [ ] **Step 5 : Lancer toute la suite frontend pour vérifier zéro régression**

```bash
cd apps/frontend && npx vitest run
```

Expected : tous les tests existants + nouveaux passent.

- [ ] **Step 6 : Commit**

```bash
git add apps/frontend/src/components/devices/TopicsTree.tsx apps/frontend/src/components/devices/TopicsTree.test.tsx
git commit -m "feat(frontend): add TopicsTree component with search and collapse"
```

---

## Task 6 : Retirer les topics non-configurés du dashboard

**Files :**
- Modify : `apps/frontend/src/app/page.tsx`

- [ ] **Step 1 : Réécrire `page.tsx`**

Remplacer entièrement le contenu de `apps/frontend/src/app/page.tsx` par :

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { History, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusIndicator } from '@/components/StatusIndicator'
import { FrigateCard } from '@/components/devices/FrigateCard'
import { WledCard } from '@/components/devices/WledCard'
import { TasmotaCard } from '@/components/devices/TasmotaCard'
import { GenericCard } from '@/components/devices/GenericCard'
import { useRoomStore } from '@/store/room'
import { createWsClient } from '@/lib/ws'
import { fetchRegistry } from '@/lib/registry-api'
import type { RegistryDevice } from '@/lib/registry-api'

const WS_URL = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? 'ws://localhost:3001/ws'

export default function DashboardPage() {
  const { devices, connected, setDevice, setDevices, setConnected } = useRoomStore()
  const [registry, setRegistry] = useState<RegistryDevice[]>([])

  useEffect(() => {
    const client = createWsClient({
      url: WS_URL,
      onSnapshot: setDevices,
      onUpdate: setDevice,
      onConnectionChange: setConnected,
    })
    return () => client.disconnect()
  }, [setDevice, setDevices, setConnected])

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
  }, [])

  function renderDevice(device: RegistryDevice): React.ReactNode[] {
    if (device.interpreter_type === 'frigate') {
      const sources = Object.values(devices).filter(d => d.source === 'frigate')
      if (sources.length === 0) return [<FrigateCard key={`frigate-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <FrigateCard key={String(d.state.camera ?? device.id)} state={d} />
      ))
    }
    if (device.interpreter_type === 'tasmota') {
      const sources = Object.values(devices).filter(d => d.source === 'tasmota')
      if (sources.length === 0) return [<TasmotaCard key={`tasmota-${device.id}`} state={undefined} />]
      return sources.map(d => (
        <TasmotaCard
          key={d.state.device_id as string}
          state={d}
          label={`Tasmota — ${d.state.device_id as string}`}
        />
      ))
    }
    if (device.interpreter_type === 'wled') {
      return [<WledCard key={`wled-${device.id}`} state={devices['wled']} />]
    }
    if (device.interpreter_type === 'raw') {
      const topic = device.topic_patterns[0] ?? ''
      return [<GenericCard key={`raw-${device.id}`} name={device.name} state={devices[`raw:${topic}`]} />]
    }
    return []
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signal Room</h1>
          <p className="text-muted-foreground text-sm mt-1">Tableau de bord de la chambre connectée</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusIndicator connected={connected} />
          <Button variant="outline" size="sm" asChild>
            <Link href="/devices">
              <Settings className="h-4 w-4 mr-2" />
              Devices
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <History className="h-4 w-4 mr-2" />
              Historique
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {registry.filter(d => d.active).flatMap(renderDevice)}
      </div>
    </main>
  )
}
```

Changements appliqués :
- Suppression des imports `useRouter`, `DiscoveredCard`, `fetchTopicsSeen`, `TopicSeen`.
- Suppression du state `discoveredTopics` et du calcul `unregisteredTopics`.
- Suppression du second `useEffect` qui chargeait les topics vus.
- Suppression du render des `<DiscoveredCard>`.

- [ ] **Step 2 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur (en particulier, aucun import inutilisé).

- [ ] **Step 3 : Lancer toute la suite de tests**

```bash
cd apps/frontend && npx vitest run
```

Expected : tous les tests passent (aucun test ne dépendait du rendu des `DiscoveredCard` dans le dashboard).

- [ ] **Step 4 : Commit**

```bash
git add apps/frontend/src/app/page.tsx
git commit -m "feat(frontend): remove discovered topics from dashboard"
```

---

## Task 7 : Refonte de la page `/devices`

**Files :**
- Modify : `apps/frontend/src/app/devices/page.tsx`

- [ ] **Step 1 : Réécrire `apps/frontend/src/app/devices/page.tsx`**

Remplacer entièrement le contenu par :

```tsx
'use client'

import { useEffect, useRef, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TopicsTree } from '@/components/devices/TopicsTree'
import { fetchRegistry, fetchTopicsSeen, addDevice, removeDevice } from '@/lib/registry-api'
import type { RegistryDevice, TopicSeen } from '@/lib/registry-api'

const INTERPRETER_TYPES = ['raw', 'frigate', 'tasmota', 'wled'] as const

function DevicesContent() {
  const searchParams = useSearchParams()
  const prefillTopic = searchParams.get('topic') ?? ''

  const [registry, setRegistry] = useState<RegistryDevice[]>([])
  const [topicsSeen, setTopicsSeen] = useState<TopicSeen[]>([])
  const [name, setName] = useState('')
  const [topicPattern, setTopicPattern] = useState(prefillTopic)
  const [interpreterType, setInterpreterType] = useState<string>('raw')
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchRegistry().then(setRegistry).catch(console.error)
    fetchTopicsSeen().then(setTopicsSeen).catch(console.error)
  }, [])

  const registeredPatterns = registry.flatMap(d => d.topic_patterns)

  async function handleRefresh() {
    setIsRefreshing(true)
    try {
      const [r, t] = await Promise.all([fetchRegistry(), fetchTopicsSeen()])
      setRegistry(r)
      setTopicsSeen(t)
    } catch (e) {
      console.error(e)
    } finally {
      setIsRefreshing(false)
    }
  }

  function handleSelectTopic(topic: string) {
    setTopicPattern(topic)
    nameInputRef.current?.focus()
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !topicPattern.trim()) {
      setError('Nom et topic requis')
      return
    }
    try {
      const id = await addDevice({
        name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType,
      })
      setRegistry(prev => [...prev, {
        id, name: name.trim(),
        topic_patterns: [topicPattern.trim()],
        interpreter_type: interpreterType as RegistryDevice['interpreter_type'],
        active: 1,
        created_at: Date.now(),
      }])
      setName('')
      setTopicPattern('')
    } catch {
      setError("Erreur lors de l'ajout")
    }
  }

  async function handleRemove(id: number) {
    await removeDevice(id)
    setRegistry(prev => prev.filter(d => d.id !== id))
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-8 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Gestion des devices</h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-6">
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Devices configurés ({registry.length})</h2>
          {registry.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun device configuré</p>
          )}
          {registry.map(device => (
            <Card key={device.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {device.name}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(device.id)}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Badge variant="secondary">{device.interpreter_type}</Badge>
                <div className="space-y-1">
                  {device.topic_patterns.map(p => (
                    <p key={p} className="text-xs font-mono text-muted-foreground">{p}</p>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Topics découverts</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label="Rafraîchir"
            >
              <RotateCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          <TopicsTree
            topics={topicsSeen}
            registeredPatterns={registeredPatterns}
            onSelectTopic={handleSelectTopic}
          />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Ajouter un device</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-name">Nom</label>
              <input
                id="device-name"
                ref={nameInputRef}
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Mon capteur"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-topic">Topic MQTT</label>
              <input
                id="device-topic"
                className="w-full border rounded px-3 py-2 text-sm font-mono bg-background"
                value={topicPattern}
                onChange={e => setTopicPattern(e.target.value)}
                placeholder="home/sensor/temp"
              />
              <p className="text-xs text-muted-foreground">
                Cliquez un topic dans l'arbre ou saisissez à la main. Wildcards MQTT supportés : + et #
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="device-type">Type d&apos;interpréteur</label>
              <select
                id="device-type"
                className="w-full border rounded px-3 py-2 text-sm bg-background"
                value={interpreterType}
                onChange={e => setInterpreterType(e.target.value)}
              >
                {INTERPRETER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">Ajouter</Button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default function DevicesPage() {
  return (
    <Suspense>
      <DevicesContent />
    </Suspense>
  )
}
```

Changements appliqués :
- Grid à 3 colonnes (`lg:grid-cols-[1fr_1fr_1fr]`).
- Nouvelle section centrale « Topics découverts » avec `<TopicsTree />` et bouton refresh.
- Suppression du `<datalist>` (rendu obsolète par l'arbre).
- Ajout de `nameInputRef`, `handleSelectTopic` qui set le topic et focus le champ Nom.
- Conservation de `useSearchParams().get('topic')` pour la rétrocompat de l'URL `?topic=…`.

- [ ] **Step 2 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 3 : Lancer toute la suite de tests**

```bash
cd apps/frontend && npx vitest run
```

Expected : tous les tests passent.

- [ ] **Step 4 : Commit**

```bash
git add apps/frontend/src/app/devices/page.tsx
git commit -m "feat(frontend): integrate topics tree, refresh, focus-after-prefill into /devices"
```

---

## Task 8 : Supprimer `DiscoveredCard`

**Files :**
- Delete : `apps/frontend/src/components/devices/DiscoveredCard.tsx`

- [ ] **Step 1 : Vérifier qu'aucun import ne reste**

```bash
cd apps/frontend && grep -r "DiscoveredCard" src/
```

Expected : aucun match (les seules références étaient dans `app/page.tsx`, supprimé à la Task 6).

- [ ] **Step 2 : Supprimer le fichier**

```bash
rm apps/frontend/src/components/devices/DiscoveredCard.tsx
```

- [ ] **Step 3 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add -u apps/frontend/src/components/devices/DiscoveredCard.tsx
git commit -m "chore(frontend): remove unused DiscoveredCard component"
```

---

## Task 9 : Vérification end-to-end

- [ ] **Step 1 : Lancer toute la suite frontend**

```bash
cd apps/frontend && npx vitest run
```

Expected : tous les tests passent (existants + 7 mqtt-matcher + ~14 topics-tree + 9 TopicsTree).

- [ ] **Step 2 : Vérifier la compilation TypeScript**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 3 : Lancer le backend et le frontend en parallèle**

Terminal 1 :
```bash
cd apps/backend && npm run dev
```

Terminal 2 :
```bash
cd apps/frontend && npm run dev
```

- [ ] **Step 4 : Vérifier le dashboard**

Ouvrir `http://localhost:3000`. Vérifier :
- Les cards des devices configurés (Frigate, Tasmota, WLED, raw) s'affichent.
- **Aucune card pointillée** pour un topic non-configuré.
- Le bouton « Devices » navigue vers `/devices`.

- [ ] **Step 5 : Vérifier la page `/devices`**

Ouvrir `http://localhost:3000/devices`. Vérifier :
- Trois colonnes affichées en desktop : Configurés | Découverts (arbre) | Ajouter.
- L'arbre est entièrement collapsé au chargement.
- Cliquer un dossier (chevron) → enfants apparaissent.
- Les feuilles configurées ont le badge `[configuré]`, les autres un point.
- Survoler une feuille → tooltip natif avec last_seen, count, type.

- [ ] **Step 6 : Tester la recherche**

Dans le champ recherche, taper `chambre` (ou un segment présent sur ton broker). Vérifier :
- Auto-expand des branches matchantes.
- Branches non-matchantes masquées.
- Effacer la recherche → tout re-collapse.

- [ ] **Step 7 : Tester le pré-remplissage + focus**

Cliquer une feuille non-configurée. Vérifier :
- Le champ Topic MQTT contient le path complet.
- Le focus se positionne sur le champ Nom (curseur visible).
- Saisir un nom + cliquer Ajouter → device apparaît dans la colonne gauche, la feuille de l'arbre passe à `[configuré]`.

- [ ] **Step 8 : Tester le refresh**

Cliquer le bouton refresh (icône RotateCw). Vérifier :
- L'icône tourne pendant le fetch.
- Le bouton est désactivé pendant le fetch.
- L'arbre et la liste se mettent à jour.

- [ ] **Step 9 : Tester la suppression**

Supprimer un device (icône poubelle). Vérifier :
- La card disparaît.
- Le badge `[configuré]` de la feuille correspondante dans l'arbre disparaît, remplacé par le point « nouveau ».

- [ ] **Step 10 : Commit final (si modifications de vérification)**

```bash
git status
```

Si tout est clean, pas de commit. Sinon :
```bash
git add -A
git commit -m "chore: end-to-end verification of topics tree"
```
