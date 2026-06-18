import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SetCombobox } from './SetCombobox'

describe('SetCombobox', () => {
  it('filters the catalog by name and resolves a pick to the set ID', () => {
    const onChange = vi.fn()
    render(<SetCombobox value="" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jungle' } })
    const option = screen.getByRole('option', { name: /jungle/i })
    fireEvent.click(within(option).getByRole('button'))

    expect(onChange).toHaveBeenLastCalledWith('base2')
    expect(screen.getByRole('combobox')).toHaveValue('Jungle')
  })

  it('passes a typed value through, resolving to an ID on an exact match', () => {
    const onChange = vi.fn()
    render(<SetCombobox value="" onChange={onChange} />)

    const input = screen.getByRole('combobox')
    // A free-text fragment that matches no set ID/name is passed through raw.
    fireEvent.change(input, { target: { value: 'sv-unknown' } })
    expect(onChange).toHaveBeenLastCalledWith('sv-unknown')
    // An exact ID resolves to that ID (the canonical stored value).
    fireEvent.change(input, { target: { value: 'base1' } })
    expect(onChange).toHaveBeenLastCalledWith('base1')
  })

  it('does not store a partial name fragment as a set ID', () => {
    const onChange = vi.fn()
    render(<SetCombobox value="" onChange={onChange} />)

    // "jung" matches Jungle but is no set's exact name/ID — it must not be
    // committed as the anchor; the value stays empty until a pick.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jung' } })
    expect(onChange).toHaveBeenLastCalledWith('')
    // The matches still surface so the user can pick the real set.
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('shows the set name, not the bare ID, for a known starting value', () => {
    render(<SetCombobox value="base1" onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toHaveValue('Base')
  })
})
