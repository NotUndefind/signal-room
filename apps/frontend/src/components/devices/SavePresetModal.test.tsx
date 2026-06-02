import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SavePresetModal } from './SavePresetModal'

describe('SavePresetModal', () => {
  it('ne rend rien quand fermé', () => {
    render(<SavePresetModal
      open={false} initialName="" onSave={vi.fn()} onClose={vi.fn()}
    />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('affiche le formulaire quand ouvert avec nom pré-rempli', () => {
    render(<SavePresetModal
      open={true} initialName="WLED salon" onSave={vi.fn()} onClose={vi.fn()}
    />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/nom/i)).toHaveValue('WLED salon')
  })

  it('appelle onSave avec nom + description', async () => {
    const onSave = vi.fn()
    render(<SavePresetModal
      open={true} initialName="WLED" onSave={onSave} onClose={vi.fn()}
    />)
    const desc = screen.getByLabelText(/description/i)
    await userEvent.type(desc, 'Ma version')
    await userEvent.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(onSave).toHaveBeenCalledWith({ name: 'WLED', description: 'Ma version' })
  })

  it('bloque la sauvegarde si le nom est vide', async () => {
    const onSave = vi.fn()
    render(<SavePresetModal
      open={true} initialName="" onSave={onSave} onClose={vi.fn()}
    />)
    await userEvent.click(screen.getByRole('button', { name: /sauvegarder/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/nom requis/i)).toBeInTheDocument()
  })

  it('appelle onClose au clic sur Annuler', async () => {
    const onClose = vi.fn()
    render(<SavePresetModal
      open={true} initialName="X" onSave={vi.fn()} onClose={onClose}
    />)
    await userEvent.click(screen.getByRole('button', { name: /annuler/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
