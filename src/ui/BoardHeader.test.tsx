import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoardHeader } from './BoardHeader'

const header = (over: Partial<React.ComponentProps<typeof BoardHeader>> = {}) => {
  const props = { title: 'Plans', onHome: vi.fn(), onRename: vi.fn(), ...over }
  render(<BoardHeader {...props} />)
  return props
}

describe('BoardHeader', () => {
  it('shows the title and goes home', () => {
    const { onHome } = header()
    expect(screen.getByTestId('board-title').textContent).toContain('Plans')
    fireEvent.click(screen.getByTestId('board-home'))
    expect(onHome).toHaveBeenCalled()
  })

  it('renames on Enter', () => {
    const { onRename } = header()
    fireEvent.click(screen.getByTestId('board-title'))
    const input = screen.getByTestId('board-title-input')
    fireEvent.change(input, { target: { value: 'Q4 plans' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('Q4 plans')
    expect(screen.queryByTestId('board-title-input')).toBeNull()
  })

  it('leaves the title alone on Escape, or when it is emptied', () => {
    const { onRename } = header()
    fireEvent.click(screen.getByTestId('board-title'))
    fireEvent.change(screen.getByTestId('board-title-input'), { target: { value: 'Nope' } })
    fireEvent.keyDown(screen.getByTestId('board-title-input'), { key: 'Escape' })
    fireEvent.click(screen.getByTestId('board-title'))
    fireEvent.change(screen.getByTestId('board-title-input'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByTestId('board-title-input'), { key: 'Enter' })
    expect(onRename).not.toHaveBeenCalled()
  })

  it('starts out renaming a board that was just made', () => {
    header({ autoRename: true })
    expect(screen.getByTestId('board-title-input')).toBeTruthy()
  })

  it('keeps its keys away from the board behind it', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    try {
      header({ autoRename: true })
      // Backspace in the title field must not delete selected nodes.
      fireEvent.keyDown(screen.getByTestId('board-title-input'), { key: 'Backspace' })
      expect(onKey).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })
})
