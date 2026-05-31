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
