import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportBanner } from './ImportBanner'

describe('ImportBanner', () => {
  it('offers the boards, counted, and reports the choice', () => {
    const onImport = vi.fn()
    const onDismiss = vi.fn()
    render(<ImportBanner count={2} busy={false} onImport={onImport} onDismiss={onDismiss} />)
    expect(screen.getByTestId('import-banner').textContent).toContain('Upload 2 boards from this browser')
    fireEvent.click(screen.getByTestId('import-yes'))
    fireEvent.click(screen.getByTestId('import-no'))
    expect(onImport).toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalled()
  })

  it('says "board" for one, and locks while uploading', () => {
    render(<ImportBanner count={1} busy onImport={() => {}} onDismiss={() => {}} />)
    expect(screen.getByTestId('import-banner').textContent).toContain('Upload 1 board from')
    expect((screen.getByTestId('import-yes') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('import-yes').textContent).toBe('Uploading…')
  })
})
