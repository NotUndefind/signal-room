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
