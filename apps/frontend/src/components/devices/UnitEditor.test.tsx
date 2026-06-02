import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UnitEditor } from './UnitEditor'
import type { UnitInput } from '@/lib/registry-api'

const baseUnit: UnitInput = {
  position: 0,
  name: 'Power',
  topic_pattern: 'wled/lamp/v',
  json_path: 'on',
  condition: null,
  transform: { type: 'passthrough' },
  output_field: 'power',
  output_type: 'boolean',
  display: { label: 'Allumé' },
}

describe('UnitEditor', () => {
  it('affiche le label de l\'unit replié par défaut', () => {
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText('Allumé')).toBeInTheDocument()
    expect(screen.queryByLabelText('topic_pattern')).not.toBeInTheDocument()
  })

  it('ouvre l\'accordion au clic sur Modifier', async () => {
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    expect(screen.getByLabelText('topic_pattern')).toBeInTheDocument()
    expect(screen.getByLabelText('output_field')).toBeInTheDocument()
    expect(screen.getByLabelText('label')).toBeInTheDocument()
    expect(screen.getByLabelText('json_path')).toBeInTheDocument()
  })

  it('émet onChange quand topic_pattern change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('topic_pattern')
    await userEvent.clear(input)
    await userEvent.type(input, 'wled/x/v')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      topic_pattern: 'wled/x/v',
    }))
  })

  it('émet onChange quand label change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('label')
    await userEvent.clear(input)
    await userEvent.type(input, 'État')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      display: expect.objectContaining({ label: 'État' }),
    }))
  })

  it('émet onChange quand output_field change', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    const input = screen.getByLabelText('output_field')
    await userEvent.clear(input)
    await userEvent.type(input, 'state')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      output_field: 'state',
    }))
  })

  it('émet onDelete quand le bouton supprimer est cliqué', async () => {
    const onDelete = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={vi.fn()} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /supprimer l'unit/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('intègre TransformEditor et propage onChange du transform', async () => {
    const onChange = vi.fn()
    render(<UnitEditor unit={baseUnit} onChange={onChange} onDelete={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /modifier/i }))
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'round')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      transform: { type: 'round', decimals: 2 },
    }))
  })
})
