import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EdgeMenu } from './EdgeMenu'

const menu = (over: Partial<React.ComponentProps<typeof EdgeMenu>> = {}) => {
  const props = {
    at: { x: 500, y: 400 },
    viewport: { w: 1200, h: 900 },
    current: null,
    effective: '#c96a6a',
    onPick: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  }
  render(<EdgeMenu {...props} />)
  return props
}

describe('EdgeMenu', () => {
  it('recolours the link from the wheel', () => {
    const { onPick } = menu()
    fireEvent.click(screen.getByTestId('swatch-#3c9bd0'))
    expect(onPick).toHaveBeenCalledWith('#3c9bd0')
  })

  it('goes back to the branch colour with Auto', () => {
    const { onPick } = menu({ current: '#3c9bd0' })
    fireEvent.click(screen.getByTestId('swatch-auto'))
    expect(onPick).toHaveBeenCalledWith(null)
  })

  it('deletes the link', () => {
    const { onDelete } = menu()
    fireEvent.click(screen.getByTestId('edge-delete'))
    expect(onDelete).toHaveBeenCalled()
  })

  it('puts the delete button on the link', () => {
    menu()
    const btn = screen.getByTestId('edge-delete')
    expect(parseFloat(btn.style.left) + parseFloat(btn.style.width) / 2).toBe(500)
    expect(parseFloat(btn.style.top) + parseFloat(btn.style.height) / 2).toBe(400)
  })
})
