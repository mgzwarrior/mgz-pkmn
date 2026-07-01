import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import * as Dialog from '@radix-ui/react-dialog'
import { InlineRenameTitle } from './InlineRenameTitle'

// InlineRenameTitle renders a Dialog.Title, so it needs a Dialog context.
function renderInDialog(props: Parameters<typeof InlineRenameTitle>[0]) {
  return render(
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Content>
          <InlineRenameTitle {...props} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  )
}

describe('InlineRenameTitle', () => {
  it('shows the name and a rename affordance, falling back when blank', () => {
    const { rerender } = renderInDialog({
      name: 'Mew hunt',
      fallback: 'Wishlist',
      noun: 'wishlist',
      onRename: vi.fn(),
    })
    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /rename wishlist/i })).toBeInTheDocument()

    rerender(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content>
            <InlineRenameTitle name="" fallback="Wishlist" noun="wishlist" onRename={vi.fn()} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    )
    expect(screen.getByText('Wishlist')).toBeInTheDocument()
  })

  it('saves a trimmed new name via onRename', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined)
    renderInDialog({ name: 'Mew hunt', fallback: 'Wishlist', noun: 'wishlist', onRename })

    fireEvent.click(screen.getByRole('button', { name: /rename wishlist/i }))
    const input = screen.getByRole('textbox', { name: /wishlist name/i })
    fireEvent.change(input, { target: { value: '  Chase board  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save wishlist name/i }))

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Chase board'))
    // Back to display mode with the (locally reflected) name.
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /wishlist name/i })).not.toBeInTheDocument(),
    )
  })

  it('saves on Enter', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined)
    renderInDialog({ name: 'Mew hunt', fallback: 'Wishlist', noun: 'wishlist', onRename })
    fireEvent.click(screen.getByRole('button', { name: /rename wishlist/i }))
    const input = screen.getByRole('textbox', { name: /wishlist name/i })
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Renamed'))
  })

  it('does not call onRename for a blank or unchanged name', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined)
    renderInDialog({ name: 'Mew hunt', fallback: 'Wishlist', noun: 'wishlist', onRename })

    fireEvent.click(screen.getByRole('button', { name: /rename wishlist/i }))
    const input = screen.getByRole('textbox', { name: /wishlist name/i })
    // Blank → the save button is disabled and clicking is a no-op.
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /save wishlist name/i })).toBeDisabled()

    // Unchanged → save closes the editor without persisting.
    fireEvent.change(input, { target: { value: 'Mew hunt' } })
    fireEvent.click(screen.getByRole('button', { name: /save wishlist name/i }))
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: /wishlist name/i })).not.toBeInTheDocument(),
    )
    expect(onRename).not.toHaveBeenCalled()
  })

  it('cancels editing on Escape without persisting', () => {
    const onRename = vi.fn()
    renderInDialog({ name: 'Mew hunt', fallback: 'Wishlist', noun: 'wishlist', onRename })
    fireEvent.click(screen.getByRole('button', { name: /rename wishlist/i }))
    const input = screen.getByRole('textbox', { name: /wishlist name/i })
    fireEvent.change(input, { target: { value: 'Discarded' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: /wishlist name/i })).not.toBeInTheDocument()
    expect(screen.getByText('Mew hunt')).toBeInTheDocument()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('keeps the editor open and flags the input when the rename fails', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('nope'))
    renderInDialog({ name: 'Mew hunt', fallback: 'Wishlist', noun: 'wishlist', onRename })
    fireEvent.click(screen.getByRole('button', { name: /rename wishlist/i }))
    const input = screen.getByRole('textbox', { name: /wishlist name/i })
    fireEvent.change(input, { target: { value: 'Retry me' } })
    fireEvent.click(screen.getByRole('button', { name: /save wishlist name/i }))

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByRole('textbox', { name: /wishlist name/i })).toBeInTheDocument()
  })
})
