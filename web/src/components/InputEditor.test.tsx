import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InputEditor } from './InputEditor'

vi.mock('../api/client', () => ({
  parseLine: vi.fn(),
}))

describe('InputEditor', () => {
  it('renders the textarea and run button', () => {
    render(<InputEditor onRun={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /look up/i })).toBeInTheDocument()
  })
})
