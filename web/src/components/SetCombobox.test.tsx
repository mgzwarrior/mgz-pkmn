import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { SetCombobox } from './SetCombobox'

describe('SetCombobox', () => {
  it('filters the catalog by name and resolves a pick to the set ID', () => {
    const onChange = vi.fn()
    render(<SetCombobox value="" onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jungle' } })
    const option = screen.getByRole('option', { name: /jungle/i })
    const button = within(option).getByRole('button')
    // mousedown is prevented so input focus survives the click → pick.
    fireEvent.mouseDown(button)
    fireEvent.click(button)

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
    // Clearing the field clears the anchor.
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
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

  it('navigates the list with the arrow keys and picks the active row on Enter', () => {
    const onChange = vi.fn()
    render(<SetCombobox value="" onChange={onChange} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'base' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    // First row is active by default; arrow down moves to the second.
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    // Arrow up returns to the first row.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'Enter' })
    // Enter commits the active row's set ID and shows its name.
    expect(onChange).toHaveBeenLastCalledWith('base1')
    expect(input).toHaveValue('Base')
  })

  it('hovering a row makes it active', () => {
    render(<SetCombobox value="" onChange={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'base' } })

    const second = screen.getAllByRole('option')[1]
    fireEvent.mouseEnter(within(second).getByRole('button'))
    expect(second).toHaveAttribute('aria-selected', 'true')
  })

  it('closes the list on Escape and re-opens on focus', () => {
    render(<SetCombobox value="" onChange={() => {}} />)
    const input = screen.getByRole('combobox')

    fireEvent.change(input, { target: { value: 'base' } })
    expect(screen.queryByRole('listbox')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.focus(input)
    expect(screen.queryByRole('listbox')).toBeInTheDocument()
  })

  it('closes the list shortly after blur', () => {
    vi.useFakeTimers()
    try {
      render(<SetCombobox value="" onChange={() => {}} />)
      const input = screen.getByRole('combobox')

      fireEvent.change(input, { target: { value: 'base' } })
      expect(screen.queryByRole('listbox')).toBeInTheDocument()

      fireEvent.blur(input)
      act(() => {
        vi.runAllTimers()
      })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides a logo that fails to load', () => {
    render(<SetCombobox value="" onChange={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jungle' } })

    const logo = screen.getByRole('option', { name: /jungle/i }).querySelector('img')
    expect(logo).not.toBeNull()
    fireEvent.error(logo!)
    expect(logo!).toHaveStyle({ display: 'none' })
  })
})

afterEach(() => {
  vi.useRealTimers()
})
