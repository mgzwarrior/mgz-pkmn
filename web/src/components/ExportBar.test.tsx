import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportBar } from './ExportBar'

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
}))

describe('ExportBar', () => {
  it('renders an Export trigger', () => {
    render(<ExportBar />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })
})
