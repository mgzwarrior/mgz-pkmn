import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PricingOverrideCell } from './PricingOverrideCell'

describe('PricingOverrideCell (#266)', () => {
  it('shows "Set override" with no pin when unset', () => {
    render(
      <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={vi.fn()} />,
    )
    expect(screen.getByText('Set override')).toBeInTheDocument()
    expect(screen.queryByLabelText('Clear override')).toBeNull()
  })

  it('shows the formatted value with a pin and a clear button when set', () => {
    render(
      <PricingOverrideCell value={12} currency="USD" label="Price override" onChange={vi.fn()} />,
    )
    expect(screen.getByText('$12.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Clear override')).toBeInTheDocument()
  })

  it('commits a typed value on Enter', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '7.5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(7.5)
  })

  it('commits a typed value on blur', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '20' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(20)
  })

  it('discards the draft on Escape without calling onChange', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={12} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('$12.00')).toBeInTheDocument()
  })

  it('clearing the field and blurring calls onChange(null) when a value was set', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={12} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('blurring an untouched empty field does not call onChange when already unset', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    fireEvent.blur(screen.getByLabelText('Price override'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not call onChange when the committed value is unchanged', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={12} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects a negative or non-numeric draft, leaving the value unchanged', () => {
    const onChange = vi.fn()
    render(
      <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={onChange} />,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    const input = screen.getByLabelText('Price override')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking the input does not bubble the click to an ancestor row', () => {
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <PricingOverrideCell value={null} currency="USD" label="Price override" onChange={vi.fn()} />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Price override'))
    rowClick.mockClear()
    fireEvent.click(screen.getByLabelText('Price override'))
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('clicking clear does not bubble the click to an ancestor row', () => {
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <PricingOverrideCell value={12} currency="USD" label="Price override" onChange={vi.fn()} />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Clear override'))
    expect(rowClick).not.toHaveBeenCalled()
  })
})
