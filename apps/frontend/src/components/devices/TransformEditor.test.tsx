import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransformEditor } from './TransformEditor'

describe('TransformEditor', () => {
  it('affiche le type courant dans le select', () => {
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/type/i)).toHaveValue('passthrough')
  })

  it('change de type vers scale via le select et émet la valeur par défaut', async () => {
    const onChange = vi.fn()
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText(/type/i), 'scale')
    expect(onChange).toHaveBeenCalledWith({
      type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: false,
    })
  })

  it('affiche les champs de scale et émet la mise à jour', async () => {
    const onChange = vi.fn()
    render(<TransformEditor
      value={{ type: 'scale', in_min: 0, in_max: 255, out_min: 0, out_max: 100, round: true }}
      onChange={onChange}
    />)
    const inMax = screen.getByLabelText(/in_max/i)
    await userEvent.clear(inMax)
    await userEvent.type(inMax, '1023')
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'scale', in_max: 1023,
    }))
  })

  it('affiche le champ decimals pour round', () => {
    render(<TransformEditor value={{ type: 'round', decimals: 2 }} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/decimals/i)).toHaveValue(2)
  })

  it('gère enum_map avec ajout/suppression de paires', async () => {
    const onChange = vi.fn()
    render(<TransformEditor
      value={{ type: 'enum_map', map: { ON: true, OFF: false } }}
      onChange={onChange}
    />)
    await userEvent.click(screen.getByRole('button', { name: /ajouter une paire/i }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'enum_map',
      map: expect.objectContaining({ ON: true, OFF: false }),
    }))
  })

  it('ne rend aucun champ pour passthrough', () => {
    render(<TransformEditor value={{ type: 'passthrough' }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText(/in_min/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/decimals/i)).not.toBeInTheDocument()
  })
})
