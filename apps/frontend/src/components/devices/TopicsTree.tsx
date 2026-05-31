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
