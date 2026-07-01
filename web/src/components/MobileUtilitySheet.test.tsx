import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MobileUtilitySheet, UtilityRow } from './MobileUtilitySheet'

describe('MobileUtilitySheet', () => {
  it('opens a sheet from the More trigger and shows the utility rows', () => {
    render(
      <MobileUtilitySheet>
        <UtilityRow label="Appearance">
          <button type="button">theme</button>
        </UtilityRow>
        <UtilityRow label="Settings">
          <button type="button">settings</button>
        </UtilityRow>
      </MobileUtilitySheet>,
    )

    // Closed initially: the rows aren't mounted.
    expect(screen.queryByText('Appearance')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument()
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('closes on the close button', () => {
    render(
      <MobileUtilitySheet>
        <UtilityRow label="Help">
          <button type="button">help</button>
        </UtilityRow>
      </MobileUtilitySheet>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByText('Help')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Help')).not.toBeInTheDocument()
  })
})
