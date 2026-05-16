import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExportBar } from './ExportBar'

vi.mock('../api/client', () => ({
  exportFile: vi.fn(),
  downloadSetCardsPdf: vi.fn(),
}))

describe('ExportBar', () => {
  it('renders all export buttons', () => {
    render(<ExportBar />)
    expect(screen.getByText('Download .xlsx')).toBeInTheDocument()
    expect(screen.getByText('PDF binder')).toBeInTheDocument()
    expect(screen.getByText('Condensed PDF')).toBeInTheDocument()
    expect(screen.getByText('Checklist')).toBeInTheDocument()
    expect(screen.getByText('Set ID cards')).toBeInTheDocument()
  })
})
