import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_EXPORT } from '../export/layout'
import { ExportDialog } from './ExportDialog'

const dialog = (over: Partial<React.ComponentProps<typeof ExportDialog>> = {}) => {
  const props = {
    initial: DEFAULT_EXPORT,
    selectionSize: 0,
    onExport: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...over,
  }
  render(<ExportDialog {...props} />)
  return props
}

describe('ExportDialog', () => {
  it('exports with the chosen options', async () => {
    const { onExport, onClose } = dialog()
    fireEvent.click(screen.getByTestId('export-format-pdf'))
    fireEvent.click(screen.getByTestId('export-pattern-lined'))
    fireEvent.click(screen.getByTestId('export-scale-3'))
    fireEvent.click(screen.getByTestId('export-go'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'pdf', pattern: 'lined', scale: 3 }))
  })

  it('offers a transparent background only for PNG', () => {
    dialog()
    expect(screen.getByTestId('export-background-transparent')).not.toHaveProperty('disabled', true)
    fireEvent.click(screen.getByTestId('export-format-jpeg'))
    expect(screen.getByTestId('export-background-transparent')).toHaveProperty('disabled', true)
  })

  it('does not hand a JPEG a transparent background chosen earlier', async () => {
    const onExport = vi.fn().mockResolvedValue(undefined)
    dialog({ onExport })
    fireEvent.click(screen.getByTestId('export-background-transparent'))
    fireEvent.click(screen.getByTestId('export-format-jpeg'))
    fireEvent.click(screen.getByTestId('export-go'))
    await waitFor(() => expect(onExport).toHaveBeenCalled())
    expect(onExport.mock.calls[0]![0].background).toBe('white')
  })

  it('offers exporting the selection only when something is selected', () => {
    dialog()
    expect(screen.queryByTestId('export-scope-selection')).toBeNull()
  })

  it('shows what went wrong and stays open', async () => {
    const { onClose } = dialog({ onExport: vi.fn().mockRejectedValue(new Error('nope')) })
    fireEvent.click(screen.getByTestId('export-go'))
    expect(await screen.findByTestId('export-error')).toHaveProperty('textContent', 'nope')
    expect(onClose).not.toHaveBeenCalled()
  })
})
